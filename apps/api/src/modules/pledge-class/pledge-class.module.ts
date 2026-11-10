import { Module } from '@nestjs/common';
import { PledgeClassService } from '../../application/services/pledge-class.service';
import { PledgeClassController } from '../../interface/controllers/pledge-class.controller';
import { SupabasePledgeClassRepository } from '../../infrastructure/supabase/repositories/supabase-pledge-class.repository';
import { PLEDGE_CLASS_REPOSITORY } from '#domain/repositories/pledge-class.repository.interface';
import { MEMBER_REPOSITORY } from '#domain/repositories/member.repository.interface';
import { SupabaseMemberRepository } from '../../infrastructure/supabase/repositories/supabase-member.repository';
import { RbacModule } from '../rbac/rbac.module';

@Module({
  // RbacModule → PermissionsGuard's role lookups.
  imports: [RbacModule],
  controllers: [PledgeClassController],
  providers: [
    PledgeClassService,
    {
      provide: PLEDGE_CLASS_REPOSITORY,
      useClass: SupabasePledgeClassRepository,
    },
    { provide: MEMBER_REPOSITORY, useClass: SupabaseMemberRepository },
  ],
})
export class PledgeClassModule {}
