import { Module } from '@nestjs/common';
import { MemberService } from '../../application/services/member.service';
import { MemberController } from '../../interface/controllers/member.controller';
import { AlumniController } from '../../interface/controllers/alumni.controller';
import { ChapterModule } from '../chapter/chapter.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [ChapterModule, AuthModule],
  controllers: [MemberController, AlumniController],
  providers: [MemberService],
  exports: [MemberService],
})
export class MemberModule {}
