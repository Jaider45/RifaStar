import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from './auth/decorators';
import { DatabaseService } from './database/database.service';
import { RedisService } from './redis/redis.service';

@ApiTags('Salud')
@Controller('health')
export class HealthController {
  constructor(
    private readonly db: DatabaseService,
    private readonly redis: RedisService,
  ) {}

  @Public()
  @Get()
  async check() {
    await this.db.system.$queryRaw`SELECT 1`;
    await this.redis.client.ping();
    return { status: 'ok' };
  }
}
