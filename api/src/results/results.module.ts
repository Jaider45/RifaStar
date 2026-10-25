import { Global, Module } from '@nestjs/common';
import { ResultsController } from './results.controller';
import { ResultsService } from './results.service';

@Global()
@Module({ controllers: [ResultsController], providers: [ResultsService], exports: [ResultsService] })
export class ResultsModule {}
