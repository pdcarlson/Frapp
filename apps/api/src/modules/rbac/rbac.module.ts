import { Module } from '@nestjs/common';
import { RbacService } from '../../application/services/rbac.service';
import { RbacController } from '../../interface/controllers/rbac.controller';
import { RoleTierService } from '../../application/services/role-tier.service';
import { RoleTierController } from '../../interface/controllers/role-tier.controller';
import { ChapterModule } from '../chapter/chapter.module';
// ChapterConfigModule → ChapterAuditLogService, which audits role writes.
import { ChapterConfigModule } from '../chapter-config/chapter-config.module';

@Module({
  imports: [ChapterModule, ChapterConfigModule],
  controllers: [RbacController, RoleTierController],
  providers: [RbacService, RoleTierService],
  exports: [RbacService],
})
export class RbacModule {}
