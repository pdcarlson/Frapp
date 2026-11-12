import { Module } from '@nestjs/common';
import { AuthSyncInterceptor } from '../../interface/interceptors/auth-sync.interceptor';
import { AuthModule } from '../auth/auth.module';
import { AiConsentService } from '../../application/services/ai/ai-consent.service';
import { ChapterAuditLogService } from '../../application/services/chapter-audit-log.service';
import {
  AiChapterSettingsController,
  AiConsentController,
} from '../../interface/controllers/ai-consent.controller';
import { SupabaseAiConsentRepository } from '../../infrastructure/supabase/repositories/supabase-ai-consent.repository';
import { SupabaseChapterAuditLogRepository } from '../../infrastructure/supabase/repositories/supabase-chapter-audit-log.repository';
import { SupabaseRoleRepository } from '../../infrastructure/supabase/repositories/supabase-role.repository';
import { AI_CONSENT_REPOSITORY } from '#domain/repositories/ai-consent.repository.interface';
import { CHAPTER_AUDIT_LOG_REPOSITORY } from '#domain/repositories/chapter-audit-log.repository.interface';
import { ROLE_REPOSITORY } from '#domain/repositories/role.repository.interface';

/**
 * AI consent (#4308): the chapter's switches, each person's answer on the AI
 * sheet, and the routes that read and change them.
 *
 * `AiConsentService` is exported for two readers: the gateway's consent seam
 * (`modules/ai/ai-consent-seam.module.ts`), and the corpus, which asks which
 * chat authors said yes (#4314).
 */
@Module({
  // `AuthSyncInterceptor` resolves the caller on the chapter-less sheet
  // routes; it needs `AuthService` and `TimeZoneSyncService`.
  imports: [AuthModule],
  controllers: [AiConsentController, AiChapterSettingsController],
  providers: [
    AiConsentService,
    AuthSyncInterceptor,
    { provide: AI_CONSENT_REPOSITORY, useClass: SupabaseAiConsentRepository },
    // The president check resolves the chapter's `PRESIDENT` role.
    { provide: ROLE_REPOSITORY, useClass: SupabaseRoleRepository },
    // A switch change is audited and mirrored to #chapter-audit.
    ChapterAuditLogService,
    {
      provide: CHAPTER_AUDIT_LOG_REPOSITORY,
      useClass: SupabaseChapterAuditLogRepository,
    },
  ],
  exports: [AiConsentService],
})
export class AiConsentModule {}
