import './common/zod-es';
import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { ZodValidationPipe } from 'nestjs-zod';
import { AuditModule } from './audit/audit.module';
import { AuthGuard } from './auth/auth.guard';
import { AuthModule } from './auth/auth.module';
import { AppErrorFilter } from './common/error.filter';
import { RequestContextMiddleware } from './common/request-context.middleware';
import { DatabaseModule } from './database/database.module';
import { HealthController } from './health.controller';
import { loggerParams } from './logger';
import { OrganizationsModule } from './organizations/organizations.module';
import { PermissionsModule } from './permissions/permissions.module';
import { RateLimitGuard } from './rate-limit/rate-limit';
import { RateLimitModule } from './rate-limit/rate-limit.module';
import { RedisModule } from './redis/redis.module';
import { SettingsModule } from './settings/settings.module';
import { TenancyModule } from './tenancy/tenancy.module';
import { DashboardModule } from './dashboard/dashboard';
import { JobsModule } from './jobs/jobs.module';
import { MaintenanceModule } from './jobs/maintenance.module';
import { OrdersModule } from './orders/orders.module';
import { ParticipantsModule } from './participants/participants.module';
import { PaymentAccountsModule } from './payment-accounts/payment-accounts';
import { PublicModule } from './public/public.module';
import { RafflesModule } from './raffles/raffles.module';
import { ResultsModule } from './results/results.module';
import { RankingModule } from './ranking/ranking.module';
import { MessagingModule } from './messaging/messaging.module';
import { MyTicketsModule } from './my-tickets/my-tickets.module';
import { PlansModule } from './plans/plans.module';
import { BillingModule } from './billing/billing.module';
import { PlatformModule } from './platform/platform.module';
import { StorageModule } from './storage/storage.module';

@Module({
  imports: [
    LoggerModule.forRoot(loggerParams()),
    DatabaseModule,
    RedisModule,
    RateLimitModule,
    AuditModule,
    PermissionsModule,
    TenancyModule,
    AuthModule,
    SettingsModule,
    StorageModule,
    PlansModule,
    MessagingModule,
    JobsModule,
    OrganizationsModule,
    PaymentAccountsModule,
    RafflesModule,
    ParticipantsModule,
    OrdersModule,
    ResultsModule,
    RankingModule,
    PublicModule,
    MyTicketsModule,
    BillingModule,
    PlatformModule,
    DashboardModule,
    MaintenanceModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_FILTER, useClass: AppErrorFilter },
    // Orden: primero el límite de solicitudes, luego la sesión.
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
