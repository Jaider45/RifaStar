import { Injectable } from '@nestjs/common';
import type { Organization } from '@prisma/client';
import { createHash } from 'node:crypto';
import { Errors } from '../common/errors';
import { normalizePhone } from '../common/phone';
import { DatabaseService } from '../database/database.service';
import { upsertParticipant } from '../participants/participants.service';
import { presentPaymentAccount } from '../payment-accounts/payment-accounts';
import { readPageConfig } from '../raffles/page-config';
import { prizeRuleLabel } from '../raffles/prize-rules';
import { PlanPolicyService } from '../plans/plan-policy.service';
import { SettingsService } from '../settings/settings.service';
import { StorageProvider } from '../storage/storage.provider';
import { encodeAvailable1b, encodeGrid2b } from './grid-encoding';

/** Hasta este tamaño la grilla va completa; arriba se consulta por bloques. */
const GRID_MAX = 10_000;
const BLOCK_SIZE = 1_000;

@Injectable()
export class PublicRafflesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly storage: StorageProvider,
    private readonly settings: SettingsService,
    private readonly plans: PlanPolicyService,
  ) {}

  async raffle(org: Organization, raffleSlug: string) {
    return this.db.tenantTx(org.id, async (tx) => {
      const r = await tx.raffle.findFirst({
        where: { slug: raffleSlug, deletedAt: null, status: { not: 'draft' } },
        include: { prizes: { orderBy: { position: 'asc' } } },
      });
      if (!r) throw Errors.notFound('el sorteo');
      const accounts = await tx.paymentAccount.findMany({
        where: { isActive: true, raffles: { some: { raffleId: r.id } } },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      });
      const branding = await this.settings.read(tx, 'branding');
      const whiteLabel = await this.plans.hasFeature(org.id, 'whiteLabel');
      const rankingOn = (await this.settings.read(tx, 'ranking')).data.enabled && (await this.plans.hasFeature(org.id, 'ranking'));
      const rafflesCompleted = await tx.raffle.count({ where: { status: 'drawn', deletedAt: null } });
      const available = r.totalNumbers - r.paidCount - r.heldCount;
      const page = readPageConfig(r.pageConfig);
      const url = (key: string | null) => (key ? this.storage.signedGetUrl(key, 3600) : Promise.resolve(null));
      return {
        organization: {
          name: org.name,
          slug: org.slug,
          supportWhatsapp: org.supportWhatsapp,
          logoUrl: await url(org.logoKey),
          showRifaStarBadge: !(branding.data.hideRifaStarBadge && whiteLabel),
          rafflesCompleted,
          timezone: org.timezone,
          rankingEnabled: rankingOn,
          social: page.show.social
            ? { instagram: branding.data.instagramUrl, facebook: branding.data.facebookUrl, tiktok: branding.data.tiktokUrl }
            : { instagram: null, facebook: null, tiktok: null },
        },
        raffle: {
          slug: r.slug,
          title: r.title,
          lottery: r.lottery,
          drawAt: r.drawAt,
          salesCloseAt: r.salesCloseAt,
          coverUrl: await url(r.coverImageKey),
          gallery: (await Promise.all(r.galleryKeys.map((k) => url(k)))).filter(Boolean),
          pricePerNumber: r.pricePerNumber,
          digits: r.digits,
          totalNumbers: r.totalNumbers,
          minPerOrder: r.minPerOrder,
          numberSelection: r.numberSelection,
          unitLabel: r.unitLabel,
          unitLabelPlural: r.unitLabelPlural,
          extraDigitsSource: r.extraDigitsSource,
          extraDigitsPosition: r.extraDigitsPosition,
          accentColor: r.accentColor ?? org.defaultAccentColor,
          conditionText: r.conditionText,
          authorizationNumber: r.authorizationNumber,
          status: r.status,
          resultsPublished: Boolean(r.resultsPublishedAt),
          page,
        },
        prizes: await Promise.all(
          r.prizes.map(async (p) => ({
            position: p.position,
            amountCop: p.amountCop,
            description: p.description,
            rule: p.rule,
            ruleLabel: prizeRuleLabel(p, org.timezone),
            anticipatedLottery: p.anticipatedLottery,
            anticipatedDrawAt: p.anticipatedDrawAt,
            imageUrl: await url(p.imageKey),
          })),
        ),
        progress: {
          paid: r.paidCount,
          held: r.heldCount,
          available,
          soldPercent: Math.floor((r.paidCount / r.totalNumbers) * 100),
        },
        paymentAccounts: accounts.map(presentPaymentAccount),
        serverTime: new Date(),
      };
    });
  }

  /** Perfil público de la org: marca y sus sorteos en venta o recientes. */
  async organization(org: Organization) {
    return this.db.tenantTx(org.id, async (tx) => {
      const branding = await this.settings.read(tx, 'branding');
      const whiteLabel = await this.plans.hasFeature(org.id, 'whiteLabel');
      const ranking = (await this.settings.read(tx, 'ranking')).data.enabled && (await this.plans.hasFeature(org.id, 'ranking'));
      const raffles = await tx.raffle.findMany({
        where: { deletedAt: null, status: { in: ['active', 'sold_out', 'closed', 'drawn'] } },
        orderBy: { drawAt: 'desc' },
        take: 12,
      });
      const present = async (r: (typeof raffles)[number]) => ({
        slug: r.slug,
        title: r.title,
        lottery: r.lottery,
        drawAt: r.drawAt,
        status: r.status,
        pricePerNumber: r.pricePerNumber,
        digits: r.digits,
        progress: { paid: r.paidCount, total: r.totalNumbers },
        coverUrl: r.coverImageKey ? await this.storage.signedGetUrl(r.coverImageKey, 3600) : null,
        resultsPublished: Boolean(r.resultsPublishedAt),
      });
      const upcoming = raffles.filter((r) => r.status === 'active' || r.status === 'sold_out').sort((a, b) => a.drawAt.getTime() - b.drawAt.getTime());
      return {
        name: org.name,
        slug: org.slug,
        supportWhatsapp: org.supportWhatsapp,
        accentColor: org.defaultAccentColor,
        logoUrl: org.logoKey ? await this.storage.signedGetUrl(org.logoKey, 3600) : null,
        showRifaStarBadge: !(branding.data.hideRifaStarBadge && whiteLabel),
        rankingEnabled: ranking,
        timezone: org.timezone,
        rafflesCompleted: await tx.raffle.count({ where: { status: 'drawn', deletedAt: null } }),
        nextRaffle: upcoming[0] ? await present(upcoming[0]) : null,
        raffles: await Promise.all(raffles.map(present)),
      };
    });
  }

  /**
   * Estado de la grilla. Hasta 10.000 números: bitset completo. En 5 y 6 cifras: sin `block`
   * devuelve cuántos libres hay en cada bloque de 1.000; con `block`, el bitset de ese bloque.
   */
  async numbers(org: Organization, raffleSlug: string, mode: 'all' | 'available', block?: number) {
    return this.db.tenantTx(org.id, async (tx) => {
      const r = await tx.raffle.findFirst({
        where: { slug: raffleSlug, deletedAt: null, status: { not: 'draft' } },
        select: { id: true, totalNumbers: true, digits: true, status: true, paidCount: true, heldCount: true },
      });
      if (!r) throw Errors.notFound('el sorteo');
      const availableCount = r.totalNumbers - r.paidCount - r.heldCount;
      const big = r.totalNumbers > GRID_MAX;

      if (big && block === undefined) {
        const rows = await tx.$queryRaw<{ b: number; n: bigint }[]>`
          SELECT (number / ${BLOCK_SIZE})::int AS b, count(*) AS n FROM raffle_numbers
           WHERE raffle_id = ${r.id}::uuid GROUP BY 1`;
        const blocks = Array.from({ length: r.totalNumbers / BLOCK_SIZE }, () => BLOCK_SIZE);
        for (const row of rows) blocks[row.b] = BLOCK_SIZE - Number(row.n);
        const body = JSON.stringify(blocks);
        return {
          total: r.totalNumbers,
          digits: r.digits,
          status: r.status,
          encoding: 'blocks' as const,
          blockSize: BLOCK_SIZE,
          /** Libres por bloque: blocks[i] = libres entre i·1000 y i·1000+999. */
          blocks,
          availableCount,
          etag: `"${createHash('sha1').update(body).update(r.status).digest('base64url')}"`,
        };
      }

      const offset = big ? block! * BLOCK_SIZE : 0;
      const size = big ? Math.min(BLOCK_SIZE, r.totalNumbers - offset) : r.totalNumbers;
      if (size <= 0) throw Errors.validation({ field: 'block' }, 'Ese bloque no existe en este sorteo.');
      const taken = (
        await tx.raffleNumber.findMany({
          where: { raffleId: r.id, number: { gte: offset, lt: offset + size } },
          select: { number: true, status: true },
        })
      ).map((t) => ({ number: t.number - offset, status: t.status }));
      const data = mode === 'all' ? encodeGrid2b(size, taken) : encodeAvailable1b(size, taken);
      return {
        total: r.totalNumbers,
        digits: r.digits,
        status: r.status,
        encoding: mode === 'all' ? ('bitset-2b' as const) : ('bitset-1b' as const),
        legend: mode === 'all' ? { 0: 'available', 1: 'reserved', 2: 'pending_verification', 3: 'paid' } : { 1: 'available' },
        /** El bit 0 del bitset es el número `offset`. */
        offset,
        size,
        availableCount,
        data: data.toString('base64'),
        etag: `"${createHash('sha1').update(data).update(r.status).update(String(offset)).digest('base64url')}"`,
      };
    });
  }

  async notifyMe(org: Organization, input: { name: string; phone: string }) {
    const phone = normalizePhone(input.phone);
    await this.db.tenantTx(org.id, async (tx) => {
      const participantId = await upsertParticipant(tx, org.id, { phone, name: input.name });
      await tx.notifyMeSubscription.upsert({
        where: { organizationId_participantId: { organizationId: org.id, participantId } },
        create: { organizationId: org.id, participantId },
        update: { unsubscribedAt: null },
      });
    });
    return { message: 'Listo. Te avisamos por WhatsApp cuando abra el próximo sorteo.' };
  }
}
