import { Module } from '@nestjs/common';
import { InviteService } from '../../application/services/invite.service';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [AuthModule, DatabaseModule],
  providers: [InviteService],
  exports: [InviteService],
})
export class InviteModule {}
