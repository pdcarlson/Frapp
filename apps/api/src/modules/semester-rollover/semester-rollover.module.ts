import { Module } from '@nestjs/common';
import { SemesterRolloverService } from '../../application/services/semester-rollover.service';
import { SemesterRolloverController } from '../../interface/controllers/semester-rollover.controller';
import { SupabaseSemesterArchiveRepository } from '../../infrastructure/supabase/repositories/supabase-semester-archive.repository';
import { SEMESTER_ARCHIVE_REPOSITORY } from '#domain/repositories/semester-archive.repository.interface';
import { SupabaseRoleRepository } from '../../infrastructure/supabase/repositories/supabase-role.repository';
import { ROLE_REPOSITORY } from '#domain/repositories/role.repository.interface';
import { RbacModule } from '../rbac/rbac.module';

@Module({
  // RbacModule so the promotion path can check the caller's *own* effective
  // permissions for `roles:manage` — Nest guards never fire on an in-process
  // service call, and the route guard only covers `semester:rollover`.
  imports: [RbacModule],
  controllers: [SemesterRolloverController],
  providers: [
    SemesterRolloverService,
    {
      provide: SEMESTER_ARCHIVE_REPOSITORY,
      useClass: SupabaseSemesterArchiveRepository,
    },
    {
      // Rollover resolves the New Member and Member system roles by `system_key`
      // when the caller asks for pledge promotion.
      provide: ROLE_REPOSITORY,
      useClass: SupabaseRoleRepository,
    },
  ],
})
export class SemesterRolloverModule {}
