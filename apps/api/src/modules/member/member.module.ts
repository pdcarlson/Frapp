import { Module } from '@nestjs/common';
import { MemberService } from '../../application/services/member.service';
import { MemberController } from '../../interface/controllers/member.controller';
import { RbacModule } from '../rbac/rbac.module';
import { UserModule } from '../user/user.module';

@Module({
  imports: [RbacModule, UserModule],
  controllers: [MemberController],
  providers: [MemberService],
  exports: [MemberService],
})
export class MemberModule {}
