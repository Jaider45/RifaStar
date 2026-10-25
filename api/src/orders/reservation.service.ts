import { Injectable } from '@nestjs/common';
import { Prisma, type Raffle } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { pepperedHash, safeEqual, sha256 } from '../common/crypto';
import { AppError, Errors } from '../common/errors';
import { formatNumber, formatNumberList } from '../common/format';
import { normalizePhone } from '../common/phone';
import { DatabaseService, type Tx } from '../database/database.service';
import { upsertParticipant } from '../participants/participants.service';
import { presentPaymentAccount } from '../payment-accounts/payment-accounts';
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

/**
 * Apartado atómico de números (regla 1). Un único UPDATE … WHERE status =
 * 'available' dentro de la transacción; si no se actualizan exactamente N
 * filas, todo se revierte y el error dice qué números se tomaron.
 */
@Injectable()
export class ReservationService {
  constructor(
    private readonly db: DatabaseService,
    private readonly settings: SettingsService,
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

      const count = input.numbers?.length ?? input.random!;
      if (count < raffle.minPerOrder) {
        throw Errors.validation(
          { field: 'numbers', min: raffle.minPerOrder },
          `La compra mínima en este sorteo es de ${raffle.minPerOrder} números.`,
        );
      }
      const outOfRange = (input.numbers ?? []).filter((n) => n >= raffle.totalNumbers);
      if (outOfRange.length > 0) {
        throw Errors.validation({ field: 'numbers', outOfRange }, `Este sorteo va del ${formatNumber(0, raffle.digits)} al ${formatNumber(raffle.totalNumbers - 1, raffle.digits)}.`);
      }

      const payments = await this.settings.read(tx, 'payments');
      const reservedUntil = new Date(Date.now() + payments.data.reservationMinutes * 60_000);
      const seller = input.sellerCode
        ? await tx.member.findFirst({ where: { sellerCode: input.sellerCode.toUpperCase(), status: 'active' }, select: { id: true, sellerCode: true } })
        : null;
      const participantId = await upsertParticipant(tx, organizationId, { phone, name: input.name, nickname: input.nickname });

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

  private async claimExact(tx: Tx, raffle: Raffle, orderId: string, wanted: number[], until: Date): Promise<number[]> {
    // Bloquea en orden de número (evita interbloqueos entre compras cruzadas) y
    // actualiza solo las filas que siguen disponibles.
    const claimed = await tx.$queryRaw<{ number: number }[]>`
      WITH free AS MATERIALIZED (
        SELECT number FROM raffle_numbers
         WHERE raffle_id = ${raffle.id}::uuid AND number = ANY(${wanted}::int[]) AND status = 'available'
         ORDER BY number
         FOR UPDATE
      )
      UPDATE raffle_numbers rn
         SET status = 'reserved', order_id = ${orderId}::uuid, reserved_until = ${until}, updated_at = now()
        FROM free
       WHERE rn.raffle_id = ${raffle.id}::uuid AND rn.number = free.number AND rn.status = 'available'
      RETURNING rn.number`;
    if (claimed.length !== wanted.length) {
      const got = new Set(claimed.map((r) => r.number));
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
    return claimed.map((r) => r.number).sort((a, b) => a - b);
  }

  private async claimRandom(tx: Tx, raffle: Raffle, orderId: string, count: number, until: Date): Promise<number[]> {
    // MATERIALIZED: la selección al azar se evalúa una sola vez (si no, el
    // planificador puede re-ejecutarla por cada fila y apartar de más).
    const claimed = await tx.$queryRaw<{ number: number }[]>`
      WITH free AS MATERIALIZED (
        SELECT number FROM raffle_numbers
         WHERE raffle_id = ${raffle.id}::uuid AND status = 'available'
         ORDER BY random()
         LIMIT ${count}
         FOR UPDATE SKIP LOCKED
      )
      UPDATE raffle_numbers rn
         SET status = 'reserved', order_id = ${orderId}::uuid, reserved_until = ${until}, updated_at = now()
        FROM free
       WHERE rn.raffle_id = ${raffle.id}::uuid AND rn.number = free.number AND rn.status = 'available'
      RETURNING rn.number`;
    if (claimed.length !== count) {
      throw new AppError(
        'NOT_ENOUGH_NUMBERS',
        409,
        claimed.length === 0 ? 'Ya no quedan números disponibles.' : `Solo quedan ${claimed.length} números disponibles.`,
        { requested: count },
      );
    }
    return claimed.map((r) => r.number).sort((a, b) => a - b);
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

export const isUniqueViolation = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
