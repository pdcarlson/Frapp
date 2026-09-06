import { Module } from '@nestjs/common';
import { PointsService } from '../../application/services/points.service';
import { PointsController } from '../../interface/controllers/points.controller';
import { POINT_TRANSACTION_REPOSITORY } from '#domain/repositories/point-transaction.repository.interface';
import { SupabasePointTransactionRepository } from '../../infrastructure/supabase/repositories/supabase-point-transaction.repository';
import { SEMESTER_ARCHIVE_REPOSITORY } from '#domain/repositories/semester-archive.repository.interface';
import { SupabaseSemesterArchiveRepository } from '../../infrastructure/supabase/repositories/supabase-semester-archive.repository';
import { NotificationModule } from '../notification/notification.module';
import { ChatModule } from '../chat/chat.module';
import { AuthModule } from '../auth/auth.module';
import { ChapterConfigModule } from '../chapter-config/chapter-config.module';

@Module({
  // ChatModule → ChatService (posts the /points card); AuthModule → USER_REPOSITORY
  // (resolves actor/recipient display names embedded in the card payload);
  // ChapterConfigModule → ChapterPointsConfigService (the chapter-configurable
  // anti-fraud limits `adjustPoints` enforces), the same way ServiceEntryModule
  // reaches ChapterServiceConfigService for its minutes-per-point rate.
  imports: [NotificationModule, ChatModule, AuthModule, ChapterConfigModule],
  controllers: [PointsController],
  providers: [
    PointsService,
    {
      provide: POINT_TRANSACTION_REPOSITORY,
      useClass: SupabasePointTransactionRepository,
    },
    {
      provide: SEMESTER_ARCHIVE_REPOSITORY,
      useClass: SupabaseSemesterArchiveRepository,
    },
  ],
  exports: [PointsService],
})
export class PointsModule {}
