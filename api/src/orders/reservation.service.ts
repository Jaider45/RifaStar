import { Injectable } from '@nestjs/common';
import { Prisma, type Raffle } from '@prisma/client';
import { randomInt, randomUUID } from 'node:crypto';
import { pepperedHash, safeEqual, sha256 } from '../common/crypto';
import { AppError, Errors } from '../common/errors';
import { formatNumber, formatNumberList } from '../common/format';
import { normalizePhone } from '../common/phone';
import { DatabaseService, type Tx } from '../database/database.service';
import { attachReferral, upsertParticipant } from '../participants/participants.service';
import { presentPaymentAccount } from '../payment-accounts/payment-accounts';
import { PlanPolicyService } from '../plans/plan-policy.service';
import { SettingsService } from '../settings/settings.service';
import type { ReserveInput } from './orders.dto';

/** Token para operar la orden sin cuenta. Se deriva del id: se puede volver a entregar en un reintento idempotente. */
export const orderAccessToken = (orderId: string) => pepperedHash(`order-access:${orderId}`).slice(0, 48);

export function verifyOrderToken(orderId: string, token: string | undefined, storedHash: string): boolean {
  return Boolean(token) && safeEqual(sha256(token!), storedHash) && safeEqual(token!, orderAccessToken(orderId));
}

export const raffleNotOnSale = (raffle: Pick<Raffle, 'status'>) =>
  new AppError(
    'RAFFLE_NOT_ON_SALE',
    409,
    raffle.status === 'sold_out' ? 'Este sorteo está agotado.' : 'La venta de este sorteo ya cerró.',
    { status: raffle.status },
  );

export function isOnSale(raffle: Pick<Raffle, 'status' | 'salesCloseAt'>, now = new Date()): boolean {
  return raffle.status === 'active' && (!raffle.salesCloseAt || raffle.salesCloseAt > now);
}

/** Hasta este tamaño se calcula la lista exacta de libres para el azar; arriba se muestrea. */
const EXACT_RANDOM_MAX = 10_000;

/**
 * Apartado atómico de números (regla 1). raffle_numbers guarda solo los números tomados:
 * apartar es un INSERT … ON CONFLICT DO NOTHING sobre la clave (raffle_id, number) dentro de
 * la transacción. Si no entran exactamente los N pedidos, todo se revierte y el error dice
 * qué números se tomaron. Dos personas nunca pueden quedarse con el mismo número.
 */
@Injectable()
export class ReservationService {
  constructor(
    private readonly db: DatabaseService,
    private readonly settings: SettingsService,
    private readonly plans: PlanPolicyService,
  ) {}

  async reserve(organizationId: string, raffleSlug: string, input: ReserveInput, idempotencyKey?: string) {
    try {
      return await this.reserveOnce(organizationId, raffleSlug, input, idempotencyKey);
    } catch (err) {
      // Dos reintentos simultáneos con la misma Idempotency-Key: el segundo devuelve la orden del primero.
      if (idempotencyKey && isUniqueViolation(err)) return this.reserveOnce(organizationId, raffleSlug, input, idempotencyKey);
      throw err;
    }
  }

  private async reserveOnce(organizationId: string, raffleSlug: string, input: ReserveInput, idempotencyKey?: string) {
    const phone = normalizePhone(input.phone);
    return this.db.tenantTx(organizationId, async (tx) => {
      const raffle = await tx.raffle.findFirst({ where: { slug: raffleSlug, deletedAt: null, status: { not: 'draft' } } });
      if (!raffle) throw Errors.notFound('el sorteo');

      if (idempotencyKey) {
        const previous = await tx.order.findFirst({ where: { raffleId: raffle.id, idempotencyKey } });
        if (previous) return this.response(tx, raffle, previous.id);
      }
      if (!isOnSale(raffle)) throw raffleNotOnSale(raffle);

      if (raffle.numberSelection === 'random' && input.numbers) {
        throw Errors.validation(
          { field: 'numbers', numberSelection: 'random' },
          'En este sorteo los números se asignan al azar. Elige cuántos quieres.',
        );
      }
      const count = input.numbers?.length ?? input.random!;
      const outOfRange = (input.numbers ?? []).filter((n) => n >= raffle.totalNumbers);
      if (outOfRange.length > 0) {
        throw Errors.validation({ field: 'numbers', outOfRange }, `Este sorteo va del ${formatNumber(0, raffle.digits)} al ${formatNumber(raffle.totalNumbers - 1, raffle.digits)}.`);
      }

      const payments = await this.settings.read(tx, 'payments');
      // Antibots: nadie retiene más de N números sin pagar a la vez (por teléfono).
      const holdLimit = payments.data.maxHeldPerPhone;
      const participant = await tx.participant.findUnique({ where: { organizationId_phone: { organizationId, phone } }, select: { id: true } });
      const mine = participant ? await this.participantNumbers(tx, raffle.id, participant.id) : { held: 0, total: 0 };
      // Compra mínima por participante: lo que ya tiene en este sorteo más lo nuevo.
      if (mine.total + count < raffle.minPerOrder) {
        const faltan = raffle.minPerOrder - mine.total;
        throw Errors.validation(
          { field: 'numbers', min: raffle.minPerOrder, alreadyHas: mine.total },
          mine.total === 0
            ? `La compra mínima en este sorteo es de ${raffle.minPerOrder} números por participante.`
            : `La compra mínima es de ${raffle.minPerOrder} números por participante: te faltan ${faltan}.`,
        );
      }
      if (holdLimit && mine.held + count > holdLimit) {
        throw new AppError(
          'HOLD_LIMIT',
          429,
          `Tienes números apartados sin pagar. Paga o espera a que se liberen antes de apartar más (máximo ${holdLimit} sin pagar).`,
          { limit: holdLimit, held: mine.held },
        );
      }

      const reservedUntil = new Date(Date.now() + payments.data.reservationMinutes * 60_000);
      const seller = input.sellerCode && (await this.plans.hasFeature(organizationId, 'sellers'))
        ? await tx.member.findFirst({ where: { sellerCode: input.sellerCode.toUpperCase(), status: 'active' }, select: { id: true, sellerCode: true } })
        : null;
      const participantId = await upsertParticipant(tx, organizationId, { phone, name: input.name, nickname: input.nickname });
      if (input.referralCode) await attachReferral(tx, organizationId, participantId, input.referralCode);

      const orderId = randomUUID();
      const placeholder = input.numbers ?? Array.from({ length: count }, (_, i) => i);
      await tx.order.create({
        data: {
          id: orderId,
          organizationId,
          raffleId: raffle.id,
          participantId,
          numbers: placeholder,
          unitPrice: raffle.pricePerNumber,
          totalCop: raffle.pricePerNumber * count,
          sellerMemberId: seller?.id ?? null,
          sellerCode: seller?.sellerCode ?? null,
          status: 'reserved',
          reservedUntil,
          accessTokenHash: sha256(orderAccessToken(orderId)),
          idempotencyKey: idempotencyKey ?? null,
        },
      });

      const numbers = input.numbers
        ? await this.claimExact(tx, raffle, orderId, input.numbers, reservedUntil)
        : await this.claimRandom(tx, raffle, orderId, count, reservedUntil);

      await tx.order.update({ where: { id: orderId }, data: { numbers } });
      await tx.$executeRaw`UPDATE raffles SET held_count = held_count + ${numbers.length}, updated_at = now() WHERE id = ${raffle.id}::uuid`;
      return this.response(tx, raffle, orderId);
    });
  }

  /** Números del participante en el sorteo: retenidos sin pagar y total (retenidos + pagos). */
  private async participantNumbers(tx: Tx, raffleId: string, participantId: string) {
    const rows = await tx.$queryRaw<{ held: bigint; total: bigint }[]>`
      SELECT count(*) FILTER (WHERE rn.status IN ('reserved', 'pending_verification')) AS held,
             count(*) AS total
        FROM raffle_numbers rn JOIN orders o ON o.id = rn.order_id
       WHERE rn.raffle_id = ${raffleId}::uuid AND o.participant_id = ${participantId}::uuid`;
    return { held: Number(rows[0]?.held ?? 0), total: Number(rows[0]?.total ?? 0) };
  }

  /** Inserta las filas de los números que sigan libres. Devuelve los que quedaron apartados. */
  private async insertFree(tx: Tx, raffle: Raffle, orderId: string, numbers: number[], until: Date): Promise<number[]> {
    if (numbers.length === 0) return [];
    // En orden de número: dos compras cruzadas esperan en el mismo orden (sin interbloqueos).
    const rows = await tx.$queryRaw<{ number: number }[]>`
      INSERT INTO raffle_numbers (raffle_id, number, organization_id, status, order_id, reserved_until, updated_at)
      SELECT ${raffle.id}::uuid, n, ${raffle.organizationId}::uuid, 'reserved', ${orderId}::uuid, ${until}, now()
        FROM unnest(${[...numbers].sort((a, b) => a - b)}::int[]) AS n
       ORDER BY n
      ON CONFLICT (raffle_id, number) DO NOTHING
      RETURNING number`;
    return rows.map((r) => r.number);
  }

  private async claimExact(tx: Tx, raffle: Raffle, orderId: string, wanted: number[], until: Date): Promise<number[]> {
    const claimed = await this.insertFree(tx, raffle, orderId, wanted, until);
    if (claimed.length !== wanted.length) {
      const got = new Set(claimed);
      const taken = wanted.filter((n) => !got.has(n)).sort((a, b) => a - b);
      const list = formatNumberList(taken, raffle.digits);
      throw new AppError(
        'NUMBERS_TAKEN',
        409,
        taken.length === 1
          ? `El número ${list} ya fue apartado por otra persona. Elige otro.`
          : `Los números ${list} ya fueron apartados por otra persona. Elige otros.`,
        { taken, takenFormatted: taken.map((n) => formatNumber(n, raffle.digits)) },
      );
    }
    return claimed.sort((a, b) => a - b);
  }

  /**
   * Al azar entre los libres. Hasta 10.000 números se calcula la lista exacta de libres;
   * en sorteos de 5 y 6 cifras (o casi vacíos) se muestrea y se reintenta con los que
   * otra compra tomó al mismo tiempo. Si quedan pocos libres, se calcula la lista exacta.
   */
  private async claimRandom(tx: Tx, raffle: Raffle, orderId: string, count: number, until: Date): Promise<number[]> {
    const notEnough = (left: number) =>
      new AppError(
        'NOT_ENOUGH_NUMBERS',
        409,
        left <= 0 ? 'Ya no quedan números disponibles.' : `Solo quedan ${left} números disponibles.`,
        { requested: count },
      );
    const fresh = await tx.raffle.findUniqueOrThrow({ where: { id: raffle.id }, select: { paidCount: true, heldCount: true } });
    const free = raffle.totalNumbers - fresh.paidCount - fresh.heldCount;
    if (free < count) throw notEnough(free);

    const claimed: number[] = [];
    const sparse = raffle.totalNumbers > EXACT_RANDOM_MAX && free > raffle.totalNumbers / 5;
    if (sparse) {
      for (let round = 0; round < 8 && claimed.length < count; round++) {
        const want = count - claimed.length;
        const candidates = new Set<number>();
        while (candidates.size < Math.min(want * 2, want + 50)) candidates.add(randomInt(raffle.totalNumbers));
        for (const n of claimed) candidates.delete(n);
        const got = await this.insertFree(tx, raffle, orderId, [...candidates].slice(0, want), until);
        claimed.push(...got);
      }
    }
    if (claimed.length < count) {
      // Lista exacta de libres (sorteos chicos, o grandes casi llenos).
      const taken = await tx.$queryRaw<{ number: number }[]>`SELECT number FROM raffle_numbers WHERE raffle_id = ${raffle.id}::uuid`;
      const used = new Set(taken.map((r) => r.number));
      const pool: number[] = [];
      for (let n = 0; n < raffle.totalNumbers; n++) if (!used.has(n)) pool.push(n);
      shuffleInPlace(pool);
      let i = 0;
      while (claimed.length < count && i < pool.length) {
        const batch = pool.slice(i, i + (count - claimed.length));
        i += batch.length;
        claimed.push(...(await this.insertFree(tx, raffle, orderId, batch, until)));
      }
    }
    if (claimed.length !== count) throw notEnough(claimed.length);
    return claimed.sort((a, b) => a - b);
  }

  private async response(tx: Tx, raffle: Raffle, orderId: string) {
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
    const payments = await this.settings.read(tx, 'payments');
    const accounts = await tx.paymentAccount.findMany({
      where: { isActive: true, raffles: { some: { raffleId: raffle.id } } },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return {
      orderId: order.id,
      accessToken: orderAccessToken(order.id),
      status: order.status,
      numbers: order.numbers.map((n) => formatNumber(n, raffle.digits)),
      numbersRaw: order.numbers,
      unitPrice: order.unitPrice,
      totalCop: order.totalCop,
      reservedUntil: order.reservedUntil,
      requireReceipt: payments.data.requireReceipt,
      raffle: { slug: raffle.slug, title: raffle.title, digits: raffle.digits },
      paymentAccounts: accounts.map(presentPaymentAccount),
    };
  }
}

function shuffleInPlace(a: number[]): void {
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
}

export const isUniqueViolation = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
