import { Module } from '@nestjs/common';
import { RbacService } from '../../application/services/rbac.service';
import { RBAC_REPOSITORY } from '../../domain/repositories/rbac.repository.interface';
import { DrizzleRbacRepository } from '../../infrastructure/database/repositories/drizzle-rbac.repository';
import { MEMBER_REPOSITORY } from '../../domain/repositories/member.repository.interface';
import { DrizzleMemberRepository } from '../../infrastructure/database/repositories/drizzle-member.repository';
import { UserModule } from '../user/user.module';
import { PermissionsGuard } from '../../interface/guards/permissions.guard';
import { RbacController } from '../../interface/controllers/rbac.controller';

@Module({
  imports: [UserModule],
  controllers: [RbacController],
  providers: [
    RbacService,
    {
      provide: RBAC_REPOSITORY,
      useClass: DrizzleRbacRepository,
    },
    {
      provide: MEMBER_REPOSITORY,
      useClass: DrizzleMemberRepository,
    },
    PermissionsGuard,
  ],
  exports: [RbacService, RBAC_REPOSITORY, MEMBER_REPOSITORY, PermissionsGuard],
})
export class RbacModule {}
