import { Global, Module } from '@nestjs/common';
import { OrderHooks } from './order-hooks';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { ReservationService } from './reservation.service';

@Global()
@Module({
  controllers: [OrdersController],
  providers: [OrdersService, ReservationService, OrderHooks],
  exports: [OrdersService, ReservationService, OrderHooks],
})
export class OrdersModule {}
