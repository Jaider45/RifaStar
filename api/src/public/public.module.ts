import { Global, Module } from '@nestjs/common';
import { PublicAccessService } from './public-access.service';
import { PublicController } from './public.controller';
import { PublicRafflesService } from './public-raffles.service';
import { SharePreviewController } from './share-preview.controller';

@Global()
@Module({
  controllers: [PublicController, SharePreviewController],
  providers: [PublicAccessService, PublicRafflesService],
  exports: [PublicAccessService],
})
export class PublicModule {}
