import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import IORedis, { type Redis } from 'ioredis';
import { env } from '../config/env';

@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;

  constructor() {
    // maxRetriesPerRequest = null es requisito de BullMQ para conexiones compartidas.
    this.client = new IORedis(env().REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: false });
  }

  /** Conexión nueva (BullMQ necesita una por Worker / QueueEvents). */
  duplicate(): Redis {
    return this.client.duplicate();
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit().catch(() => undefined);
  }
}
