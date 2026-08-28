import { Module } from '@nestjs/common';
import { RbacService } from '../../application/services/rbac.service';
import { RbacController } from '../../interface/controllers/rbac.controller';
import { ChapterModule } from '../chapter/chapter.module';
// ChapterConfigModule → CustomRoleService, which the permission resolver uses
// to flatten custom-role capabilities (bridge model, spec/behavior/rbac.md).
import { ChapterConfigModule } from '../chapter-config/chapter-config.module';

@Module({
  imports: [ChapterModule, ChapterConfigModule],
  controllers: [RbacController],
  providers: [RbacService],
  exports: [RbacService],
})
export class RbacModule {}
