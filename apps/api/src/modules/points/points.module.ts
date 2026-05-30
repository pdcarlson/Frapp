import { Module } from '@nestjs/common';
import { PointsService } from '../../application/services/points.service';
import { PointsController } from '../../interface/controllers/points.controller';
import { POINT_TRANSACTION_REPOSITORY } from '../../domain/repositories/point-transaction.repository.interface';
import { SupabasePointTransactionRepository } from '../../infrastructure/supabase/repositories/supabase-point-transaction.repository';
import { SEMESTER_ARCHIVE_REPOSITORY } from '../../domain/repositories/semester-archive.repository.interface';
import { SupabaseSemesterArchiveRepository } from '../../infrastructure/supabase/repositories/supabase-semester-archive.repository';
import { NotificationModule } from '../notification/notification.module';
import { ChatModule } from '../chat/chat.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  // ChatModule → ChatService (posts the /points card); AuthModule → USER_REPOSITORY
  // (resolves actor/recipient display names embedded in the card payload).
  imports: [NotificationModule, ChatModule, AuthModule],
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
  exports: [PointsService, POINT_TRANSACTION_REPOSITORY],
})
export class PointsModule {}
