import { Module } from '@nestjs/common';
import { PledgeClassService } from '../../application/services/pledge-class.service';
import { PledgeClassController } from '../../interface/controllers/pledge-class.controller';
import { SupabasePledgeClassRepository } from '../../infrastructure/supabase/repositories/supabase-pledge-class.repository';
import { PLEDGE_CLASS_REPOSITORY } from '#domain/repositories/pledge-class.repository.interface';
import { RbacModule } from '../rbac/rbac.module';
import { ChapterModule } from '../chapter/chapter.module';

@Module({
  // RbacModule → PermissionsGuard's role lookups, and the rank and channel
  // rules on assignments; ChapterModule → the member and group reads they
  // judge.
  imports: [RbacModule, ChapterModule],
  controllers: [PledgeClassController],
  providers: [
    PledgeClassService,
    {
      provide: PLEDGE_CLASS_REPOSITORY,
      useClass: SupabasePledgeClassRepository,
    },
  ],
})
export class PledgeClassModule {}
