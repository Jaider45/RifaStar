import { Controller, Get, Injectable, Module } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { startOfLocalWeek } from '../common/time';
import { DatabaseService } from '../database/database.service';
import { CurrentOrg, OrgScoped, RequirePermission } from '../permissions/decorators';
import { LIVE_STATUSES } from '../raffles/raffles.service';
import { can, type OrgContext } from '../tenancy/org-context';

@Injectable()
export class DashboardService {
  constructor(private readonly db: DatabaseService) {}

  get(org: OrgContext) {
    const now = new Date();
    const weekStart = startOfLocalWeek(now, org.timezone);
    return this.db.tenantTx(org.id, async (tx) => {
      const [weekRevenue, pendingPayments, activeRaffles, next] = await Promise.all([
        tx.order.aggregate({ where: { status: 'approved', verifiedAt: { gte: weekStart } }, _sum: { totalCop: true }, _count: true }),
        tx.order.count({ where: { status: 'pending_verification' } }),
        tx.raffle.count({ where: { status: { in: LIVE_STATUSES }, deletedAt: null } }),
        tx.raffle.findFirst({
          where: { status: { in: LIVE_STATUSES }, deletedAt: null, drawAt: { gte: now } },
          orderBy: { drawAt: 'asc' },
        }),
      ]);
      return {
        weekStartsAt: weekStart,
        ...(can(org, 'payments.view') && {
          weekRevenueCop: weekRevenue._sum.totalCop ?? 0,
          weekApprovedOrders: weekRevenue._count,
        }),
        pendingPayments,
        activeRaffles,
        nextRaffle: next && {
          id: next.id,
          title: next.title,
          slug: next.slug,
          drawAt: next.drawAt,
          status: next.status,
          progress: { paid: next.paidCount, held: next.heldCount, total: next.totalNumbers },
        },
      };
    });
  }
}

@ApiTags('Dashboard')
@OrgScoped()
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  @RequirePermission('raffles.view')
  get(@CurrentOrg() org: OrgContext) {
    return this.dashboard.get(org);
  }
}

@Module({ controllers: [DashboardController], providers: [DashboardService] })
export class DashboardModule {}
