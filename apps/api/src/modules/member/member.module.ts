import { Module } from '@nestjs/common';
import { MemberService } from '../../application/services/member.service';
import { MemberController } from '../../interface/controllers/member.controller';
import { ChapterModule } from '../chapter/chapter.module';

@Module({
  imports: [ChapterModule],
  controllers: [MemberController],
  providers: [MemberService],
  exports: [MemberService],
})
export class MemberModule {}
