import { PrismaClient } from '@prisma/client';
import { execSync } from 'node:child_process';
import IORedis from 'ioredis';
import { seedBase } from '../prisma/seed-base';
import './setup-env';

/** Base de tests limpia: borra el esquema, aplica migraciones y el seed base. */
export default async function globalSetup(): Promise<void> {
  const owner = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
  await owner.$executeRawUnsafe('DROP SCHEMA IF EXISTS public CASCADE');
  await owner.$executeRawUnsafe('CREATE SCHEMA public');
  await owner.$disconnect();

  execSync('npx prisma migrate deploy', { stdio: 'pipe', env: process.env });

  const system = new PrismaClient({ datasourceUrl: process.env.SYSTEM_DATABASE_URL });
  await seedBase(system);
  await system.$disconnect();

  const redis = new IORedis(process.env.REDIS_URL!);
  await redis.flushdb();
  await redis.quit();
}
