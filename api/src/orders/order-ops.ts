import { Prisma } from '@prisma/client';
import type { Tx } from '../database/database.service';

/**
 * Operaciones de bajo nivel sobre órdenes y números. Reciben la transacción:
 * con un `tenantTx` respetan RLS; los jobs las llaman con el cliente de sistema.
 */

/** Vence órdenes `reserved` sin comprobante y libera sus números. Idempotente. */
export async function expireReservedOrders(
  tx: Tx,
  opts: { raffleId?: string; onlyDue: boolean; batchSize?: number },
): Promise<{ orderIds: string[]; byRaffle: Map<string, number> }> {
  const limit = opts.batchSize ?? 500;
  const raffleFilter = opts.raffleId ? Prisma.sql`AND raffle_id = ${opts.raffleId}::uuid` : Prisma.empty;
  const dueFilter = opts.onlyDue ? Prisma.sql`AND reserved_until < now()` : Prisma.empty;
  const expired = await tx.$queryRaw<{ id: string }[]>`
    WITH due AS (
      SELECT id FROM orders
       WHERE status = 'reserved' AND receipt_key IS NULL ${raffleFilter} ${dueFilter}
       ORDER BY reserved_until
       LIMIT ${limit}
       FOR UPDATE SKIP LOCKED
    )
    UPDATE orders o SET status = 'expired', expired_at = now(), updated_at = now()
      FROM due WHERE o.id = due.id
    RETURNING o.id`;
  const orderIds = expired.map((r) => r.id);
  const byRaffle = await releaseHeldNumbers(tx, orderIds);
  return { orderIds, byRaffle };
}

/**
 * Libera los números apartados o en verificación de las órdenes dadas (borra sus filas:
 * un número sin fila está libre) y ajusta `held_count`. Devuelve cuántos liberó por sorteo.
 */
export async function releaseHeldNumbers(tx: Tx, orderIds: string[]): Promise<Map<string, number>> {
  const byRaffle = new Map<string, number>();
  if (orderIds.length === 0) return byRaffle;
  const released = await tx.$queryRaw<{ raffle_id: string }[]>`
    DELETE FROM raffle_numbers
     WHERE order_id = ANY(${orderIds}::uuid[]) AND status IN ('reserved', 'pending_verification')
    RETURNING raffle_id`;
  for (const r of released) byRaffle.set(r.raffle_id, (byRaffle.get(r.raffle_id) ?? 0) + 1);
  for (const [raffleId, n] of byRaffle) {
    await tx.$executeRaw`UPDATE raffles SET held_count = held_count - ${n}, updated_at = now() WHERE id = ${raffleId}::uuid`;
  }
  return byRaffle;
}

/** Libera números pagados (al liberar una orden aprobada) y ajusta `paid_count`. */
export async function releasePaidNumbers(tx: Tx, orderId: string, raffleId: string): Promise<number> {
  const n = await tx.$executeRaw`
    DELETE FROM raffle_numbers WHERE order_id = ${orderId}::uuid AND status = 'paid'`;
  if (n > 0) {
    await tx.$executeRaw`UPDATE raffles SET paid_count = paid_count - ${n}, updated_at = now() WHERE id = ${raffleId}::uuid`;
  }
  return n;
}

/** Bloquea la fila de la orden hasta el final de la transacción. */
export async function lockOrder(tx: Tx, orderId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM orders WHERE id = ${orderId}::uuid FOR UPDATE`;
  return rows.length === 1;
}
