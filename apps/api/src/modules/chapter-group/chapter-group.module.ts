import { Module } from '@nestjs/common';
import { ChapterGroupService } from '../../application/services/chapter-group.service';
import { ChapterGroupController } from '../../interface/controllers/chapter-group.controller';
// ChapterModule → the group, role and tier repositories.
import { ChapterModule } from '../chapter/chapter.module';
// ChapterConfigModule → ChapterAuditLogService, which audits group writes.
import { ChapterConfigModule } from '../chapter-config/chapter-config.module';
// RbacModule → PermissionsGuard's role lookups.
import { RbacModule } from '../rbac/rbac.module';

/** Groups (#4076): `GET/POST /v1/groups` and one group's routes. */
@Module({
  imports: [ChapterModule, ChapterConfigModule, RbacModule],
  controllers: [ChapterGroupController],
  providers: [ChapterGroupService],
  // For Frapp AI's people tools (#4901), which read groups as `GET
  // /v1/groups` does.
  exports: [ChapterGroupService],
})
export class ChapterGroupModule {}
