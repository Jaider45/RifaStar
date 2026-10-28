import { Prisma } from '@prisma/client';

/** Modelos con organization_id obligatorio: se filtran y completan solos. */
export const TENANT_MODELS: ReadonlySet<Prisma.ModelName> = new Set<Prisma.ModelName>([
  'Member',
  'OrgSettings',
  'PaymentAccount',
  'Raffle',
  'RafflePaymentAccount',
  'Prize',
  'RaffleNumber',
  'Participant',
  'Order',
  'Ticket',
  'NotifyMeSubscription',
  'OtpChallenge',
  'DrawResult',
  'Winner',
  'RankingPeriod',
  'PointsEvent',
  'UsageCounter',
  'Subscription',
  'Invoice',
  'SupportSession',
  'AuditLog',
  'MessageLog',
  'IncomeReceipt',
]);

const WHERE_OPS = new Set([
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'findUnique',
  'findUniqueOrThrow',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'delete',
  'deleteMany',
  'upsert',
]);

type Args = Record<string, unknown> & { where?: Record<string, unknown>; data?: unknown; create?: unknown };

function withOrg(data: unknown, organizationId: string): unknown {
  if (!data || typeof data !== 'object') return data;
  const d = data as Record<string, unknown>;
  if ('organization' in d) return d; // escritura por relación: la valida RLS
  if (d.organizationId !== undefined && d.organizationId !== organizationId) {
    throw new Error('Intento de escribir datos de otra organización.');
  }
  return { ...d, organizationId };
}

/**
 * Primera barrera de aislamiento: toda consulta de Prisma sobre un modelo del
 * tenant lleva `organizationId` de la organización de la transacción. La
 * segunda barrera es RLS en Postgres.
 */
export function tenantExtension(organizationId: string) {
  return Prisma.defineExtension({
    name: 'tenant-scope',
    query: {
      $allModels: {
        $allOperations({ model, operation, args, query }) {
          if (!TENANT_MODELS.has(model as Prisma.ModelName)) return query(args);
          const a = { ...(args as Args) };
          if (WHERE_OPS.has(operation)) {
            a.where = { ...(a.where ?? {}), organizationId };
          }
          if (operation === 'create') a.data = withOrg(a.data, organizationId);
          if (operation === 'createMany' || operation === 'createManyAndReturn') {
            a.data = Array.isArray(a.data) ? a.data.map((d) => withOrg(d, organizationId)) : withOrg(a.data, organizationId);
          }
          if (operation === 'upsert') a.create = withOrg(a.create, organizationId);
          return query(a);
        },
      },
    },
  });
}
