import { Module } from '@nestjs/common';
import { UserService } from '../../application/services/user.service';
import { UserController } from '../../interface/controllers/user.controller';
import { AuthSyncGuard } from '../../interface/guards/auth-sync.guard';
import { AuthModule } from '../auth/auth.module';
import { ChapterModule } from '../chapter/chapter.module';
import { STORAGE_PROVIDER } from '../../domain/adapters/storage.interface';
import { SupabaseStorageService } from '../../infrastructure/storage/supabase-storage.service';

@Module({
  imports: [AuthModule, ChapterModule],
  controllers: [UserController],
  providers: [
    UserService,
    AuthSyncGuard,
    { provide: STORAGE_PROVIDER, useClass: SupabaseStorageService },
  ],
  exports: [UserService],
})
export class UserModule {}
