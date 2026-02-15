import { Module } from '@nestjs/common';
import { InviteService } from '../../application/services/invite.service';
import { InviteController } from '../../interface/controllers/invite.controller';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { ChapterModule } from '../chapter/chapter.module';

@Module({
  imports: [AuthModule, DatabaseModule, ChapterModule],
  controllers: [InviteController],
  providers: [InviteService],
  exports: [InviteService],
})
export class InviteModule {}
