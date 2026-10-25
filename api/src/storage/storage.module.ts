import { Global, Module } from '@nestjs/common';
import { env } from '../config/env';
import { FakeStorageProvider, S3StorageProvider, StorageProvider } from './storage.provider';
import { UploadsService } from './uploads.service';

@Global()
@Module({
  providers: [
    { provide: StorageProvider, useClass: env().STORAGE_DRIVER === 'fake' ? FakeStorageProvider : S3StorageProvider },
    UploadsService,
  ],
  exports: [StorageProvider, UploadsService],
})
export class StorageModule {}
