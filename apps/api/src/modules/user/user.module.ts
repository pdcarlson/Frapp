import { Module } from '@nestjs/common';
import { UserService } from '../../application/services/user.service';
import { UserController } from '../../interface/controllers/user.controller';
import { AuthSyncInterceptor } from '../../interface/interceptors/auth-sync.interceptor';
import { AuthModule } from '../auth/auth.module';
import { ChapterModule } from '../chapter/chapter.module';
import { RbacModule } from '../rbac/rbac.module';
import { STORAGE_PROVIDER } from '../../domain/adapters/storage.interface';
import { SupabaseStorageService } from '../../infrastructure/storage/supabase-storage.service';

@Module({
  imports: [AuthModule, ChapterModule, RbacModule],
  controllers: [UserController],
  providers: [
    UserService,
    AuthSyncInterceptor,
    { provide: STORAGE_PROVIDER, useClass: SupabaseStorageService },
  ],
  exports: [UserService],
})
export class UserModule {}
