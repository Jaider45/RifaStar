import { Module } from '@nestjs/common';
import { AppModule } from './app.module';
import { MaintenanceWorker } from './jobs/maintenance.worker';
import { MessagesWorker } from './messaging/messages.worker';

/** Proceso de segundo plano: los mismos servicios que la API + procesadores BullMQ. */
@Module({ imports: [AppModule], providers: [MaintenanceWorker, MessagesWorker] })
export class WorkerModule {}
