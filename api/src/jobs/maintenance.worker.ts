import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { type Job, Worker } from 'bullmq';
import { RedisService } from '../redis/redis.service';
import { JOB, MAINTENANCE_QUEUE } from './jobs.constants';
import { MaintenanceService } from './maintenance.service';
import { SchedulerService } from './scheduler.service';

type Handler = (job: Job) => Promise<unknown>;

/**
 * Procesador de la cola de mantenimiento. Solo corre en el proceso worker.
 * Las tareas repetibles se registran con upsertJobScheduler (idempotente).
 */
@Injectable()
export class MaintenanceWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MaintenanceWorker.name);
  private worker?: Worker;
  private readonly handlers = new Map<string, Handler>();

  constructor(
    private readonly redis: RedisService,
    private readonly scheduler: SchedulerService,
    private readonly maintenance: MaintenanceService,
  ) {
    this.register(JOB.expireReservations, () => this.maintenance.expireReservations());
    this.register(JOB.closeSalesSweep, () => this.maintenance.closeSalesSweep());
    this.register(JOB.closeSales, (job) => this.maintenance.closeSales(job.data.organizationId, job.data.raffleId));
  }

  /** Otras fases agregan sus manejadores aquí (ranking, recordatorios, facturación…). */
  register(name: string, handler: Handler): void {
    this.handlers.set(name, handler);
  }

  async onModuleInit(): Promise<void> {
    const q = this.scheduler.maintenance;
    await q.upsertJobScheduler(JOB.expireReservations, { every: 60_000 }, { name: JOB.expireReservations });
    await q.upsertJobScheduler(JOB.closeSalesSweep, { every: 60_000 }, { name: JOB.closeSalesSweep });

    this.worker = new Worker(
      MAINTENANCE_QUEUE,
      async (job) => {
        const handler = this.handlers.get(job.name);
        if (!handler) throw new Error(`Job desconocido: ${job.name}`);
        return handler(job);
      },
      { connection: this.redis.duplicate(), concurrency: 4 },
    );
    this.worker.on('failed', (job, err) => this.logger.error(`Job ${job?.name} (${job?.id}) falló: ${err.message}`));
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }
}
