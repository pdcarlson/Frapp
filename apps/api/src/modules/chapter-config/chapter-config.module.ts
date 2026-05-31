import { Module } from '@nestjs/common';
import { ChapterConfigService } from '../../application/services/chapter-config.service';
import { ChapterConfigController } from '../../interface/controllers/chapter-config.controller';
import { CustomRoleService } from '../../application/services/custom-role.service';
import { CustomRoleController } from '../../interface/controllers/custom-role.controller';

@Module({
  controllers: [ChapterConfigController, CustomRoleController],
  providers: [ChapterConfigService, CustomRoleService],
  exports: [ChapterConfigService, CustomRoleService],
})
export class ChapterConfigModule {}
