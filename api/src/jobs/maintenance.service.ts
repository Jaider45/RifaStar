import { Injectable, Logger } from '@nestjs/common';
import { requestContext } from '../common/request-context';
import { DatabaseService } from '../database/database.service';
import { expireReservedOrders } from '../orders/order-ops';
import { RafflesService } from '../raffles/raffles.service';
import { RankingService } from '../ranking/ranking.service';

/** Lógica de los jobs de mantenimiento. Todo es idempotente. */
@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger(MaintenanceService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly raffles: RafflesService,
    private readonly ranking: RankingService,
  ) {}

  /** expire-reservations: libera órdenes apartadas vencidas sin comprobante. */
  async expireReservations(): Promise<number> {
    let total = 0;
    for (;;) {
      const { orderIds } = await this.db.system.$transaction((tx) => expireReservedOrders(tx, { onlyDue: true, batchSize: 500 }));
      total += orderIds.length;
      if (orderIds.length < 500) break;
    }
    if (total > 0) this.logger.log(`Apartados vencidos liberados: ${total}`);
    return total;
  }

  /** close-sales: cierra un sorteo si ya llegó su hora límite. */
  async closeSales(organizationId: string, raffleId: string): Promise<boolean> {
    return requestContext.run({ requestId: `job-close-${raffleId}`, actor: { type: 'system', id: null } }, () =>
      this.raffles.closeSales(organizationId, raffleId, { manual: false }),
    );
  }

  /** Red de seguridad por si un job diferido se perdió. */
  async closeSalesSweep(): Promise<number> {
    const due = await this.db.system.raffle.findMany({
      where: { status: { in: ['active', 'sold_out'] }, salesCloseAt: { lte: new Date() }, deletedAt: null },
      select: { id: true, organizationId: true },
      take: 200,
    });
    let closed = 0;
    for (const r of due) if (await this.closeSales(r.organizationId, r.id)) closed++;
    return closed;
  }

  /**
   * ranking-rollover: cierra los periodos vencidos (según la zona horaria de
   * cada org, ya calculada en ends_at) y abre los nuevos. Idempotente.
   */
  async rankingRollover(now = new Date()): Promise<number> {
    const due = await this.db.system.rankingPeriod.findMany({
      where: { status: 'open', endsAt: { lte: now } },
      select: { organizationId: true },
      take: 500,
    });
    let closed = 0;
    for (const { organizationId } of due) {
      try {
        if (await this.ranking.rollover(organizationId, now)) closed++;
      } catch (err) {
        this.logger.error(`Rollover de ranking falló para ${organizationId}: ${(err as Error).message}`);
      }
    }
    return closed;
  }
}
