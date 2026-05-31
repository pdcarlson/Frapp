import { Module } from '@nestjs/common';
import { ChapterConfigService } from '../../application/services/chapter-config.service';
import { ChapterConfigController } from '../../interface/controllers/chapter-config.controller';
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
  providers: [ChapterConfigService, CustomRoleService, CustomFieldService],
  exports: [ChapterConfigService, CustomRoleService, CustomFieldService],
})
export class ChapterConfigModule {}
