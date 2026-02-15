import { Module } from '@nestjs/common';
import { BackworkController } from '../../interface/controllers/backwork.controller';
import { BackworkService } from '../../application/services/backwork.service';
import { DrizzleBackworkRepository } from '../../infrastructure/database/repositories/drizzle-backwork.repository';
import { BACKWORK_REPOSITORY } from '../../domain/repositories/backwork.repository.interface';
import { DatabaseModule } from '../database/database.module';
import { StorageModule } from '../storage/storage.module';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [ConfigModule, DatabaseModule, StorageModule],
  controllers: [BackworkController],
  providers: [
    BackworkService,
    {
      provide: BACKWORK_REPOSITORY,
      useClass: DrizzleBackworkRepository,
    },
  ],
  exports: [BackworkService],
})
export class BackworkModule {}
