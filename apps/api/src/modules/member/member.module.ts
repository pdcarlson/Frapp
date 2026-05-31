import { Module } from '@nestjs/common';
import { MemberService } from '../../application/services/member.service';
import { MemberController } from '../../interface/controllers/member.controller';
import { AlumniController } from '../../interface/controllers/alumni.controller';
import { ChapterModule } from '../chapter/chapter.module';
import { AuthModule } from '../auth/auth.module';
import { ChapterConfigModule } from '../chapter-config/chapter-config.module';
import { RbacModule } from '../rbac/rbac.module';

@Module({
  imports: [ChapterModule, AuthModule, ChapterConfigModule, RbacModule],
  controllers: [MemberController, AlumniController],
  providers: [MemberService],
  exports: [MemberService],
})
export class MemberModule {}
