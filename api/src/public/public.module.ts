import { Global, Module } from '@nestjs/common';
import { PublicAccessService } from './public-access.service';
import { PublicController } from './public.controller';
import { PublicRafflesService } from './public-raffles.service';

@Global()
@Module({
  controllers: [PublicController],
  providers: [PublicAccessService, PublicRafflesService],
  exports: [PublicAccessService],
})
export class PublicModule {}
