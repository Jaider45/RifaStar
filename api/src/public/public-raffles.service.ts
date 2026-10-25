import { Injectable } from '@nestjs/common';
import type { Organization } from '@prisma/client';
import { createHash } from 'node:crypto';
import { Errors } from '../common/errors';
import { normalizePhone } from '../common/phone';
import { DatabaseService } from '../database/database.service';
import { upsertParticipant } from '../participants/participants.service';
import { presentPaymentAccount } from '../payment-accounts/payment-accounts';
import { prizeRuleLabel } from '../raffles/prize-rules';
import { PlanPolicyService } from '../plans/plan-policy.service';
import { SettingsService } from '../settings/settings.service';
import { StorageProvider } from '../storage/storage.provider';
import { encodeAvailable1b, encodeGrid2b } from './grid-encoding';

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
      const available = r.totalNumbers - r.paidCount - r.heldCount;
      return {
        organization: {
          name: org.name,
          slug: org.slug,
          supportWhatsapp: org.supportWhatsapp,
          logoUrl: org.logoKey ? await this.storage.signedGetUrl(org.logoKey, 3600) : null,
          showRifaStarBadge: !(branding.data.hideRifaStarBadge && whiteLabel),
        },
        raffle: {
          slug: r.slug,
          title: r.title,
          lottery: r.lottery,
          drawAt: r.drawAt,
          salesCloseAt: r.salesCloseAt,
          coverUrl: r.coverImageKey ? await this.storage.signedGetUrl(r.coverImageKey, 3600) : null,
          pricePerNumber: r.pricePerNumber,
          digits: r.digits,
          totalNumbers: r.totalNumbers,
          minPerOrder: r.minPerOrder,
          accentColor: r.accentColor ?? org.defaultAccentColor,
          conditionText: r.conditionText,
          authorizationNumber: r.authorizationNumber,
          status: r.status,
          resultsPublished: Boolean(r.resultsPublishedAt),
        },
        prizes: r.prizes.map((p) => ({
          position: p.position,
          amountCop: p.amountCop,
          description: p.description,
          rule: p.rule,
          ruleLabel: prizeRuleLabel(p, org.timezone),
          anticipatedLottery: p.anticipatedLottery,
          anticipatedDrawAt: p.anticipatedDrawAt,
        })),
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

  async numbers(org: Organization, raffleSlug: string, mode: 'all' | 'available') {
    return this.db.tenantTx(org.id, async (tx) => {
      const r = await tx.raffle.findFirst({
        where: { slug: raffleSlug, deletedAt: null, status: { not: 'draft' } },
        select: { id: true, totalNumbers: true, digits: true, status: true },
      });
      if (!r) throw Errors.notFound('el sorteo');
      const taken = await tx.raffleNumber.findMany({
        where: { raffleId: r.id, status: { not: 'available' } },
        select: { number: true, status: true },
      });
      const data = mode === 'all' ? encodeGrid2b(r.totalNumbers, taken) : encodeAvailable1b(r.totalNumbers, taken);
      return {
        total: r.totalNumbers,
        digits: r.digits,
        status: r.status,
        encoding: mode === 'all' ? 'bitset-2b' : 'bitset-1b',
        legend: mode === 'all' ? { 0: 'available', 1: 'reserved', 2: 'pending_verification', 3: 'paid' } : { 1: 'available' },
        availableCount: r.totalNumbers - taken.length,
        data: data.toString('base64'),
        etag: `"${createHash('sha1').update(data).update(r.status).digest('base64url')}"`,
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
