import { Inject, Injectable, Logger } from '@nestjs/common';
import { RBAC_REPOSITORY } from '../../domain/repositories/rbac.repository.interface';
import type { IRbacRepository } from '../../domain/repositories/rbac.repository.interface';
import { MEMBER_REPOSITORY } from '../../domain/repositories/member.repository.interface';
import type { IMemberRepository } from '../../domain/repositories/member.repository.interface';
import { Role } from '../../domain/entities/rbac.entity';

@Injectable()
export class RbacService {
  private readonly logger = new Logger(RbacService.name);

  constructor(
    @Inject(RBAC_REPOSITORY)
    private readonly rbacRepo: IRbacRepository,
    @Inject(MEMBER_REPOSITORY)
    private readonly memberRepo: IMemberRepository,
  ) {}

  async getPermissionsForUser(
    userId: string,
    chapterId: string,
  ): Promise<Set<string>> {
    const member = await this.memberRepo.findByUserAndChapter(
      userId,
      chapterId,
    );
    if (!member || !member.roleIds || member.roleIds.length === 0) {
      return new Set();
    }

    const roles = await this.rbacRepo.findRolesByIds(member.roleIds);
    const permissions = new Set<string>();

    for (const role of roles) {
      for (const permission of role.permissions) {
        permissions.add(permission);
      }
    }

    return permissions;
  }

  async createRole(
    chapterId: string,
    name: string,
    permissions: string[],
  ): Promise<Role> {
    this.logger.log(`Creating role ${name} for chapter ${chapterId}`);
    return this.rbacRepo.createRole({
      chapterId,
      name,
      permissions,
      isSystem: false,
    });
  }

  async getRolesForChapter(chapterId: string): Promise<Role[]> {
    return this.rbacRepo.findRolesByChapter(chapterId);
  }
}
