import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { RedisService } from '../redis/redis.service';
import { JOB, MAINTENANCE_QUEUE } from './jobs.constants';

export interface SchedulableRaffle {
  id: string;
  organizationId: string;
  salesCloseAt: Date | null;
  drawAt: Date;
}

/**
 * Programa trabajos diferidos. El jobId incluye la fecha objetivo: si la fecha
 * cambia se crea otro job y el viejo queda como no-op (el procesador verifica
 * el estado antes de actuar).
 */
@Injectable()
export class SchedulerService implements OnModuleDestroy {
  readonly maintenance: Queue;

  constructor(redis: RedisService) {
    this.maintenance = new Queue(MAINTENANCE_QUEUE, {
      connection: redis.duplicate(),
      defaultJobOptions: { removeOnComplete: 1000, removeOnFail: 5000, attempts: 5, backoff: { type: 'exponential', delay: 10_000 } },
    });
  }

  static closeSalesJobId(raffleId: string, at: Date) {
    return `close-sales_${raffleId}_${at.getTime()}`;
  }

  async scheduleRaffle(raffle: SchedulableRaffle): Promise<void> {
    if (raffle.salesCloseAt) {
      await this.maintenance.add(
        JOB.closeSales,
        { organizationId: raffle.organizationId, raffleId: raffle.id, at: raffle.salesCloseAt.toISOString() },
        {
          jobId: SchedulerService.closeSalesJobId(raffle.id, raffle.salesCloseAt),
          delay: Math.max(0, raffle.salesCloseAt.getTime() - Date.now()),
        },
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.maintenance.close();
  }
}
