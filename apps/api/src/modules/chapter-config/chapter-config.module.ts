import { Module } from '@nestjs/common';
import { WORKFLOWS_SEED } from '@repo/org-archetypes';
import { ChapterConfigService } from '../../application/services/chapter-config.service';
import { ChapterConfigController } from '../../interface/controllers/chapter-config.controller';
import {
  ChapterWorkflowsService,
  ORG_WORKFLOWS_SEED,
} from '../../application/services/chapter-workflows.service';
import { ChapterServiceConfigService } from '../../application/services/chapter-service-config.service';
import { ChapterPointsConfigService } from '../../application/services/chapter-points-config.service';
import { CustomRoleService } from '../../application/services/custom-role.service';
import { CustomRoleController } from '../../interface/controllers/custom-role.controller';
import { CustomFieldService } from '../../application/services/custom-field.service';
import { CustomFieldController } from '../../interface/controllers/custom-field.controller';
import { ChapterAuditLogService } from '../../application/services/chapter-audit-log.service';
import { ChapterAuditLogController } from '../../interface/controllers/chapter-audit-log.controller';
import { CHAPTER_AUDIT_LOG_REPOSITORY } from '#domain/repositories/chapter-audit-log.repository.interface';
import { SupabaseChapterAuditLogRepository } from '../../infrastructure/supabase/repositories/supabase-chapter-audit-log.repository';
import { ActivationModule } from '../activation/activation.module';

@Module({
  imports: [ActivationModule],
  controllers: [
    ChapterConfigController,
    CustomRoleController,
    CustomFieldController,
    ChapterAuditLogController,
  ],
  providers: [
    ChapterConfigService,
    ChapterWorkflowsService,
    ChapterServiceConfigService,
    ChapterPointsConfigService,
    // Seed catalog as a value provider — see the token's doc comment.
    { provide: ORG_WORKFLOWS_SEED, useValue: WORKFLOWS_SEED },
    CustomRoleService,
    CustomFieldService,
    ChapterAuditLogService,
    {
      provide: CHAPTER_AUDIT_LOG_REPOSITORY,
      useClass: SupabaseChapterAuditLogRepository,
    },
  ],
  exports: [
    ChapterConfigService,
    ChapterWorkflowsService,
    ChapterServiceConfigService,
    ChapterPointsConfigService,
    CustomRoleService,
    CustomFieldService,
    ChapterAuditLogService,
  ],
})
export class ChapterConfigModule {}
