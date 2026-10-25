import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { requestContext } from '../common/request-context';
import { DatabaseService, type Tx } from '../database/database.service';

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | null;
  organizationId?: string | null;
  before?: unknown;
  after?: unknown;
}

const toJson = (v: unknown) =>
  v === undefined || v === null ? Prisma.JsonNull : (JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue);

/**
 * Registro de actividad. Toma actor, IP y sesión de soporte del contexto de la
 * request. Dentro de una transacción del tenant se escribe con esa misma
 * transacción, así que si la operación se revierte, el registro también.
 */
@Injectable()
export class AuditService {
  constructor(private readonly db: DatabaseService) {}

  private data(entry: AuditEntry): Prisma.AuditLogUncheckedCreateInput {
    const ctx = requestContext.get();
    return {
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      organizationId: entry.organizationId ?? ctx?.organizationId ?? null,
      actorType: ctx?.actor?.type ?? 'system',
      actorId: ctx?.actor?.id ?? null,
      actorLabel: ctx?.actor?.label ?? null,
      supportSessionId: ctx?.supportSessionId ?? null,
      ip: ctx?.ip ?? null,
      userAgent: ctx?.userAgent?.slice(0, 300) ?? null,
      requestId: ctx?.requestId ?? null,
      before: toJson(entry.before),
      after: toJson(entry.after),
    };
  }

  /** Dentro de una transacción del tenant (`tenantTx`). */
  async record(tx: Tx, entry: AuditEntry): Promise<void> {
    await tx.auditLog.create({ data: this.data(entry) });
  }

  /** Fuera de un tenant: acciones de plataforma, login, sistema. */
  async recordSystem(entry: AuditEntry, tx?: Tx): Promise<void> {
    await (tx ?? this.db.system).auditLog.create({ data: this.data(entry) });
  }
}
