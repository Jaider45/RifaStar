import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { env } from '../config/env';
import { tenantExtension } from './tenant-extension';

export type Tx = Prisma.TransactionClient;

export interface TxOptions {
  isolationLevel?: Prisma.TransactionIsolationLevel;
  timeoutMs?: number;
}

/**
 * Dos conexiones con roles de base de datos distintos:
 *
 * - `app`: rol `rifastar_app`, sin BYPASSRLS. Todo acceso a datos de una
 *   organización pasa por `tenantTx()`, que fija `app.org_id` para la
 *   transacción; las políticas RLS filtran lo demás.
 * - `system`: rol `rifastar_system`, con BYPASSRLS. Solo para la plataforma,
 *   la autenticación, la resolución de la org y los despachadores de jobs.
 */
@Injectable()
export class DatabaseService implements OnModuleDestroy {
  readonly app: PrismaClient;
  readonly system: PrismaClient;

  constructor() {
    this.app = new PrismaClient({ datasourceUrl: env().APP_DATABASE_URL });
    this.system = new PrismaClient({ datasourceUrl: env().SYSTEM_DATABASE_URL });
  }

  /**
   * Ejecuta `fn` en una transacción de la organización: Prisma agrega el filtro
   * `organizationId` a cada consulta (tenant-extension) y Postgres aplica RLS
   * con `app.org_id`.
   */
  tenantTx<T>(organizationId: string, fn: (tx: Tx) => Promise<T>, opts: TxOptions = {}): Promise<T> {
    return this.app.$extends(tenantExtension(organizationId)).$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT set_config('app.org_id', ${organizationId}, true)`;
        return fn(tx as unknown as Tx);
      },
      {
        isolationLevel: opts.isolationLevel ?? Prisma.TransactionIsolationLevel.ReadCommitted,
        timeout: opts.timeoutMs ?? 15_000,
        maxWait: 10_000,
      },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([this.app.$disconnect(), this.system.$disconnect()]);
  }
}
