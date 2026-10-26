import { Global, Module } from '@nestjs/common';
import { env } from '../config/env';
import { LotteriesController, LotteryWebhookController } from './lottery.controller';
import { FakeLotteryProvider, LoteriaYaProvider, LotteryProvider } from './lottery.provider';
import { LotteryService } from './lottery.service';

@Global()
@Module({
  controllers: [LotteriesController, LotteryWebhookController],
  providers: [
    { provide: LotteryProvider, useClass: env().LOTTERY_DRIVER === 'loteriaya' ? LoteriaYaProvider : FakeLotteryProvider },
    LotteryService,
  ],
  exports: [LotteryProvider, LotteryService],
})
export class LotteryModule {}
