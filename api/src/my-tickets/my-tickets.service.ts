import { Injectable } from '@nestjs/common';
import type { Organization } from '@prisma/client';
import { pepperedHash, randomDigits, safeEqual } from '../common/crypto';
import { AppError } from '../common/errors';
import { formatNumber } from '../common/format';
import { normalizePhone } from '../common/phone';
import { TokensService } from '../auth/tokens.service';
import { DatabaseService } from '../database/database.service';
import { MessagesService } from '../messaging/messages.service';
import { RankingService } from '../ranking/ranking.service';

const OTP_TTL_MS = 10 * 60_000;
const OTP_MAX_ATTEMPTS = 5;
const otpInvalid = () => new AppError('OTP_INVALID', 401, 'El código no es correcto o ya venció. Pide uno nuevo.');

/**
 * «Mis boletos»: nunca se muestran boletos solo con el teléfono. Primero un
 * código de 6 dígitos por WhatsApp; luego un token de participante (30 min).
 */
@Injectable()
export class MyTicketsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly messages: MessagesService,
    private readonly tokens: TokensService,
    private readonly ranking: RankingService,
  ) {}

  /** Responde igual exista o no el participante (no revela quién compró). */
  async requestOtp(org: Organization, rawPhone: string): Promise<void> {
    const phone = normalizePhone(rawPhone);
    const challenge = await this.db.tenantTx(org.id, async (tx) => {
      const participant = await tx.participant.findFirst({ where: { phone } });
      if (!participant) return null;
      const code = randomDigits(6);
      const row = await tx.otpChallenge.create({
        data: { organizationId: org.id, phone, codeHash: pepperedHash(`${org.id}:${phone}:${code}`), expiresAt: new Date(Date.now() + OTP_TTL_MS) },
      });
      return { id: row.id, code, participantId: participant.id };
    });
    if (!challenge) return;
    await this.messages.enqueue(
      org.id,
      'otp_code',
      phone,
      { code: challenge.code, org: org.name },
      { idempotencyKey: `otp:${challenge.id}`, participantId: challenge.participantId },
    );
  }

  async verifyOtp(org: Organization, rawPhone: string, code: string): Promise<{ token: string; expiresIn: number }> {
    const phone = normalizePhone(rawPhone);
    const participantId = await this.db.tenantTx(org.id, async (tx) => {
      const ch = await tx.otpChallenge.findFirst({ where: { phone, consumedAt: null }, orderBy: { createdAt: 'desc' } });
      if (!ch || ch.expiresAt <= new Date()) throw otpInvalid();
      if (ch.attempts >= OTP_MAX_ATTEMPTS) {
        throw new AppError('OTP_LOCKED', 429, 'Superaste los intentos permitidos. Pide un código nuevo.');
      }
      if (!safeEqual(ch.codeHash, pepperedHash(`${org.id}:${phone}:${code}`))) {
        await tx.otpChallenge.update({ where: { id: ch.id }, data: { attempts: { increment: 1 } } });
        return null;
      }
      await tx.otpChallenge.update({ where: { id: ch.id }, data: { consumedAt: new Date() } });
      const p = await tx.participant.findFirstOrThrow({ where: { phone } });
      return p.id;
    });
    if (!participantId) throw otpInvalid();
    const expiresIn = 30 * 60;
    return { token: this.tokens.signParticipant({ typ: 'participant', sub: participantId, org: org.id }, expiresIn), expiresIn };
  }

  async view(org: Organization, participantId: string) {
    return this.db.tenantTx(org.id, async (tx) => {
      let p = await tx.participant.findFirstOrThrow({ where: { id: participantId } });
      if (!p.referralCode) {
        await tx.$executeRaw`
          UPDATE participants SET referral_code = upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))
           WHERE id = ${p.id}::uuid AND referral_code IS NULL`;
        p = await tx.participant.findFirstOrThrow({ where: { id: participantId } });
      }
      const orders = await tx.order.findMany({
        where: { participantId, status: { in: ['reserved', 'pending_verification', 'approved'] } },
        include: { raffle: { include: { drawResult: true } }, tickets: { where: { status: 'valid' } } },
        orderBy: { createdAt: 'desc' },
        take: 200,
      });
      const wins = await tx.winner.findMany({ where: { participantId }, include: { prize: true } });
      const byRaffle = new Map<string, { raffle: (typeof orders)[number]['raffle']; tickets: { code: string; number: string }[]; pending: { orderId: string; status: string; numbers: string[] }[] }>();
      for (const o of orders) {
        const entry = byRaffle.get(o.raffleId) ?? { raffle: o.raffle, tickets: [], pending: [] };
        if (o.status === 'approved') {
          entry.tickets.push(...o.tickets.map((t) => ({ code: t.code, number: formatNumber(t.number, o.raffle.digits) })));
        } else {
          entry.pending.push({ orderId: o.id, status: o.status, numbers: o.numbers.map((n) => formatNumber(n, o.raffle.digits)) });
        }
        byRaffle.set(o.raffleId, entry);
      }
      return {
        participant: { name: p.name, nickname: p.nickname, referralCode: p.referralCode },
        raffles: [...byRaffle.values()].map(({ raffle, tickets, pending }) => {
          const published = raffle.resultsPublishedAt && raffle.drawResult;
          const myWins = wins.filter((w) => w.raffleId === raffle.id);
          return {
            slug: raffle.slug,
            title: raffle.title,
            lottery: raffle.lottery,
            drawAt: raffle.drawAt,
            status: raffle.status,
            tickets,
            pending,
            result: published ? { mainResult: raffle.drawResult!.mainResult, anticipatedResult: raffle.drawResult!.anticipatedResult } : null,
            won: published
              ? myWins.map((w) => ({ number: formatNumber(w.number, raffle.digits), prize: w.prize.amountCop ?? w.prize.description, delivered: w.deliveryStatus === 'delivered' }))
              : [],
          };
        }),
        ranking: await this.ranking.positionOf(tx, org.id, participantId),
      };
    });
  }
}
