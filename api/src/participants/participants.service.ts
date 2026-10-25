import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Errors } from '../common/errors';
import { formatNumber } from '../common/format';
import { maskPhone } from '../common/phone';
import { AuditService } from '../audit/audit.service';
import { DatabaseService, type Tx } from '../database/database.service';
import { can, type OrgContext } from '../tenancy/org-context';

export interface ParticipantInput {
  phone: string;
  name: string;
  nickname?: string | null;
}

/** Alta o actualización atómica (sin carreras entre dos compras simultáneas del mismo teléfono). */
export async function upsertParticipant(tx: Tx, organizationId: string, input: ParticipantInput): Promise<string> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    INSERT INTO participants (id, organization_id, phone, name, nickname, referral_code, first_seen_at, last_seen_at)
    VALUES (gen_random_uuid(), ${organizationId}::uuid, ${input.phone}, ${input.name}, ${input.nickname ?? null},
            upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)), now(), now())
    ON CONFLICT (organization_id, phone) DO UPDATE
      SET name = EXCLUDED.name,
          nickname = COALESCE(EXCLUDED.nickname, participants.nickname),
          last_seen_at = now()
    RETURNING id`;
  return rows[0].id;
}

/**
 * Bono por referir (P5): el código `?ref=` solo se guarda en la primera
 * compra de un participante nuevo, y nunca apunta a sí mismo.
 */
export async function attachReferral(tx: Tx, organizationId: string, participantId: string, code: string): Promise<void> {
  await tx.$executeRaw`
    UPDATE participants p
       SET referred_by_id = ref.id
      FROM participants ref
     WHERE p.id = ${participantId}::uuid AND p.organization_id = ${organizationId}::uuid
       AND p.referred_by_id IS NULL
       AND ref.organization_id = ${organizationId}::uuid AND ref.referral_code = ${code.toUpperCase()} AND ref.id <> p.id
       AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.participant_id = p.id)`;
}

/** Evita la inyección de fórmulas al abrir el CSV en una hoja de cálculo. */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

@Injectable()
export class ParticipantsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  private search(q?: string): Prisma.ParticipantWhereInput {
    if (!q) return {};
    const digits = q.replace(/\D/g, '');
    return {
      OR: [
        { name: { contains: q, mode: 'insensitive' } },
        ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : []),
      ],
    };
  }

  async list(org: OrgContext, query: { q?: string; raffleId?: string; cursor?: string; limit: number }) {
    return this.db.tenantTx(org.id, async (tx) => {
      const rows = await tx.participant.findMany({
        where: {
          ...this.search(query.q),
          ...(query.raffleId && { orders: { some: { raffleId: query.raffleId } } }),
        },
        orderBy: [{ lastSeenAt: 'desc' }, { id: 'asc' }],
        take: query.limit + 1,
        ...(query.cursor && { cursor: { id: query.cursor }, skip: 1 }),
        include: { _count: { select: { tickets: { where: { status: 'valid' } } } } },
      });
      const page = rows.slice(0, query.limit);
      return {
        items: page.map((p) => ({
          id: p.id,
          name: p.name,
          nickname: p.nickname,
          phone: p.phone,
          firstSeenAt: p.firstSeenAt,
          lastSeenAt: p.lastSeenAt,
          ticketsCount: p._count.tickets,
        })),
        nextCursor: rows.length > query.limit ? page[page.length - 1].id : null,
      };
    });
  }

  async detail(org: OrgContext, id: string) {
    return this.db.tenantTx(org.id, async (tx) => {
      const p = await tx.participant.findFirst({
        where: { id },
        include: {
          orders: { orderBy: { createdAt: 'desc' }, take: 100, include: { raffle: { select: { id: true, title: true, digits: true } } } },
          tickets: { where: { status: 'valid' }, orderBy: { issuedAt: 'desc' }, take: 200 },
        },
      });
      if (!p) throw Errors.notFound('el participante');
      const approved = p.orders.filter((o) => o.status === 'approved');
      return {
        id: p.id,
        name: p.name,
        nickname: p.nickname,
        phone: p.phone,
        firstSeenAt: p.firstSeenAt,
        lastSeenAt: p.lastSeenAt,
        totals: {
          approvedOrders: approved.length,
          paidNumbers: approved.reduce((n, o) => n + o.numbers.length, 0),
          paidCop: approved.reduce((n, o) => n + o.totalCop, 0),
        },
        orders: p.orders.map((o) => ({
          id: o.id,
          raffle: { id: o.raffle.id, title: o.raffle.title },
          numbers: o.numbers.map((n) => formatNumber(n, o.raffle.digits)),
          totalCop: o.totalCop,
          status: o.status,
          createdAt: o.createdAt,
        })),
        tickets: p.tickets.map((t) => ({ id: t.id, code: t.code, raffleId: t.raffleId, issuedAt: t.issuedAt })),
      };
    });
  }

  async exportCsv(org: OrgContext, raffleId?: string): Promise<string> {
    return this.db.tenantTx(org.id, async (tx) => {
      const rows = await tx.$queryRaw<
        { name: string; phone: string; first_seen_at: Date; approved_orders: bigint; paid_numbers: bigint; paid_cop: bigint }[]
      >`
        SELECT p.name, p.phone, p.first_seen_at,
               COUNT(o.id) FILTER (WHERE o.status = 'approved') AS approved_orders,
               COALESCE(SUM(cardinality(o.numbers)) FILTER (WHERE o.status = 'approved'), 0) AS paid_numbers,
               COALESCE(SUM(o.total_cop) FILTER (WHERE o.status = 'approved'), 0) AS paid_cop
          FROM participants p
          LEFT JOIN orders o ON o.participant_id = p.id ${raffleId ? Prisma.sql`AND o.raffle_id = ${raffleId}::uuid` : Prisma.empty}
         WHERE p.organization_id = ${org.id}::uuid
         GROUP BY p.id
         ${raffleId ? Prisma.sql`HAVING COUNT(o.id) > 0` : Prisma.empty}
         ORDER BY p.name`;
      await this.audit.record(tx, {
        action: 'participants.export',
        entityType: 'participant',
        after: { rows: rows.length, raffleId: raffleId ?? null },
      });
      const header = ['nombre', 'whatsapp', 'primer_contacto', 'ordenes_aprobadas', 'numeros_pagados', 'total_pagado_cop'];
      const lines = rows.map((r) =>
        [r.name, r.phone, r.first_seen_at.toISOString(), r.approved_orders, r.paid_numbers, r.paid_cop].map(csvCell).join(','),
      );
      return `\uFEFF${[header.join(','), ...lines].join('\n')}\n`;
    });
  }

  /** Teléfono completo solo con participants.view_contact. */
  static phoneFor(org: OrgContext, phone: string) {
    return can(org, 'participants.view_contact') ? phone : maskPhone(phone);
  }
}
