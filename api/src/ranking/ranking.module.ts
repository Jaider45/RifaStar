import { Global, Module } from '@nestjs/common';
import { RankingController } from './ranking.controller';
import { RankingService } from './ranking.service';

@Global()
@Module({ controllers: [RankingController], providers: [RankingService], exports: [RankingService] })
export class RankingModule {}
