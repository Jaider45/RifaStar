import { Global, Module } from '@nestjs/common';
import { ReceiptsController } from './receipts.controller';
import { ReceiptsService } from './receipts.service';

@Global()
@Module({ controllers: [ReceiptsController], providers: [ReceiptsService], exports: [ReceiptsService] })
export class ReceiptsModule {}
