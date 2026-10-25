import { Module } from '@nestjs/common';
import { MyTicketsController } from './my-tickets.controller';
import { MyTicketsService } from './my-tickets.service';
import { ParticipantGuard } from './participant.guard';

@Module({ controllers: [MyTicketsController], providers: [MyTicketsService, ParticipantGuard] })
export class MyTicketsModule {}
