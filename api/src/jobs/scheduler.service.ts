import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { env } from '../config/env';
import { RedisService } from '../redis/redis.service';
import { JOB, MAINTENANCE_QUEUE, MESSAGES_QUEUE } from './jobs.constants';

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
  readonly messages: Queue;

  /** Intentos de send-whatsapp (backoff exponencial desde MESSAGES_RETRY_BASE_MS). */
  static readonly MESSAGE_ATTEMPTS = 6;

  constructor(redis: RedisService) {
    this.messages = new Queue(MESSAGES_QUEUE, {
      connection: redis.duplicate(),
      defaultJobOptions: {
        removeOnComplete: 5000,
        removeOnFail: 10000,
        attempts: SchedulerService.MESSAGE_ATTEMPTS,
        backoff: { type: 'exponential', delay: env().MESSAGES_RETRY_BASE_MS },
      },
    });
    this.maintenance = new Queue(MAINTENANCE_QUEUE, {
      connection: redis.duplicate(),
      defaultJobOptions: { removeOnComplete: 1000, removeOnFail: 5000, attempts: 5, backoff: { type: 'exponential', delay: 10_000 } },
    });
  }

  static closeSalesJobId(raffleId: string, at: Date) {
    return `close-sales_${raffleId}_${at.getTime()}`;
  }

  static drawReminderJobId(raffleId: string, drawAt: Date) {
    return `draw-reminder_${raffleId}_${drawAt.getTime()}`;
  }

  async scheduleRaffle(raffle: SchedulableRaffle): Promise<void> {
    const remindAt = raffle.drawAt.getTime() - 2 * 3_600_000;
    if (remindAt > Date.now()) {
      await this.maintenance.add(
        JOB.drawReminder,
        { organizationId: raffle.organizationId, raffleId: raffle.id, drawAt: raffle.drawAt.toISOString() },
        { jobId: SchedulerService.drawReminderJobId(raffle.id, raffle.drawAt), delay: remindAt - Date.now() },
      );
    }
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
    await Promise.all([this.maintenance.close(), this.messages.close()]);
  }
}
