import { Module } from '@nestjs/common';
import { WORKFLOWS_SEED } from '@repo/org-archetypes';
import { ChapterConfigService } from '../../application/services/chapter-config.service';
import { ChapterConfigController } from '../../interface/controllers/chapter-config.controller';
import {
  ChapterWorkflowsService,
  ORG_WORKFLOWS_SEED,
} from '../../application/services/chapter-workflows.service';
import { ChapterServiceConfigService } from '../../application/services/chapter-service-config.service';
import { CustomRoleService } from '../../application/services/custom-role.service';
import { CustomRoleController } from '../../interface/controllers/custom-role.controller';
import { CustomFieldService } from '../../application/services/custom-field.service';
import { CustomFieldController } from '../../interface/controllers/custom-field.controller';

@Module({
  controllers: [
    ChapterConfigController,
    CustomRoleController,
    CustomFieldController,
  ],
  providers: [
    ChapterConfigService,
    ChapterWorkflowsService,
    ChapterServiceConfigService,
    // Seed catalog as a value provider — see the token's doc comment.
    { provide: ORG_WORKFLOWS_SEED, useValue: WORKFLOWS_SEED },
    CustomRoleService,
    CustomFieldService,
  ],
  exports: [
    ChapterConfigService,
    ChapterWorkflowsService,
    ChapterServiceConfigService,
    CustomRoleService,
    CustomFieldService,
  ],
})
export class ChapterConfigModule {}
