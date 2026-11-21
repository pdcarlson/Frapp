import { Module } from '@nestjs/common';
import { UserService } from '../../application/services/user.service';
import { DisplayNameLockService } from '../../application/services/display-name-lock.service';
import { ChapterAuditLogService } from '../../application/services/chapter-audit-log.service';
import { CHAPTER_AUDIT_LOG_REPOSITORY } from '#domain/repositories/chapter-audit-log.repository.interface';
import { SupabaseChapterAuditLogRepository } from '../../infrastructure/supabase/repositories/supabase-chapter-audit-log.repository';
import { AccountDeletionService } from '../../application/services/account-deletion.service';
import { UserController } from '../../interface/controllers/user.controller';
import { AuthSyncInterceptor } from '../../interface/interceptors/auth-sync.interceptor';
import { AnalyticsModule } from '../analytics/analytics.module';
import { AuthModule } from '../auth/auth.module';
import { ChapterModule } from '../chapter/chapter.module';
import { RbacModule } from '../rbac/rbac.module';
import { ReportRetentionModule } from '../report-retention/report-retention.module';
import { MEMBER_REPOSITORY } from '#domain/repositories/member.repository.interface';
import { SupabaseMemberRepository } from '../../infrastructure/supabase/repositories/supabase-member.repository';
import { STORAGE_PROVIDER } from '#domain/adapters/storage.interface';
import { SupabaseStorageService } from '../../infrastructure/storage/supabase-storage.service';
import { AUTH_ADMIN_PROVIDER } from '#domain/adapters/auth-admin.interface';
import { SupabaseAuthAdminService } from '../../infrastructure/supabase/supabase-auth-admin.service';
import { ProfilePhotoModule } from '../profile-photo/profile-photo.module';

@Module({
  imports: [
    AnalyticsModule,
    AuthModule,
    ChapterModule,
    RbacModule,
    // Account deletion sweeps the departing member's chapters' report exports
    // alongside their profile photos (spec/behavior/data-retention.md).
    ReportRetentionModule,
    ProfilePhotoModule,
  ],
  controllers: [UserController],
  providers: [
    UserService,
    // #5801: whether a member's own rename is locked, and its audit line.
    // `CHAPTER_REPOSITORY` and `ROLE_REPOSITORY` come from `ChapterModule`.
    DisplayNameLockService,
    ChapterAuditLogService,
    {
      provide: CHAPTER_AUDIT_LOG_REPOSITORY,
      useClass: SupabaseChapterAuditLogRepository,
    },
    AccountDeletionService,
    AuthSyncInterceptor,
    { provide: MEMBER_REPOSITORY, useClass: SupabaseMemberRepository },
    { provide: STORAGE_PROVIDER, useClass: SupabaseStorageService },
    { provide: AUTH_ADMIN_PROVIDER, useClass: SupabaseAuthAdminService },
  ],
  // `BootstrapModule` reads the profile and What's new from it (#4709).
  exports: [UserService],
})
export class UserModule {}
