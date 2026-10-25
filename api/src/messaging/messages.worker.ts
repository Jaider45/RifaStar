import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Worker } from 'bullmq';
import { MESSAGES_QUEUE } from '../jobs/jobs.constants';
import { SchedulerService } from '../jobs/scheduler.service';
import { RedisService } from '../redis/redis.service';
import { MessagesService } from './messages.service';

/** Procesador de la cola send-whatsapp (solo en el proceso worker). */
@Injectable()
export class MessagesWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MessagesWorker.name);
  private worker?: Worker;

  constructor(
    private readonly redis: RedisService,
    private readonly messages: MessagesService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker(MESSAGES_QUEUE, (job) => this.messages.process(job.data.messageId), {
      connection: this.redis.duplicate(),
      concurrency: 10,
      // Ritmo máximo hacia Meta.
      limiter: { max: 40, duration: 1000 },
    });
    this.worker.on('failed', async (job, err) => {
      if (!job) return;
      if (job.attemptsMade >= (job.opts.attempts ?? SchedulerService.MESSAGE_ATTEMPTS)) {
        await this.messages.markFailed(job.data.messageId, err.message).catch((e) => this.logger.error(e));
      }
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }
}
