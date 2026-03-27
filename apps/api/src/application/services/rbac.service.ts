import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ROLE_REPOSITORY } from '../../domain/repositories/role.repository.interface';
import type { IRoleRepository } from '../../domain/repositories/role.repository.interface';
import { MEMBER_REPOSITORY } from '../../domain/repositories/member.repository.interface';
import type { IMemberRepository } from '../../domain/repositories/member.repository.interface';
import { Role } from '../../domain/entities/role.entity';
import { SystemPermissions } from '../../domain/constants/permissions';

@Injectable()
export class RbacService {
  constructor(
    @Inject(ROLE_REPOSITORY) private readonly roleRepo: IRoleRepository,
    @Inject(MEMBER_REPOSITORY) private readonly memberRepo: IMemberRepository,
  ) {}

  async findByChapter(chapterId: string): Promise<Role[]> {
    return this.roleRepo.findByChapter(chapterId);
  }

  async create(chapterId: string, data: Partial<Role>): Promise<Role> {
    const existing = await this.roleRepo.findByChapterAndName(
      chapterId,
      data.name!,
    );
    if (existing)
      throw new ConflictException('Role name already exists in this chapter');

    return this.roleRepo.create({
      ...data,
      chapter_id: chapterId,
      is_system: false,
    });
  }

  async update(roleId: string, data: Partial<Role>): Promise<Role> {
    const role = await this.roleRepo.findById(roleId);
    if (!role) throw new NotFoundException('Role not found');

    if (data.name && data.name !== role.name) {
      const existing = await this.roleRepo.findByChapterAndName(
        role.chapter_id,
        data.name,
      );
      if (existing)
        throw new ConflictException('Role name already exists in this chapter');
    }

    return this.roleRepo.update(roleId, data);
  }

  async delete(roleId: string): Promise<void> {
    const role = await this.roleRepo.findById(roleId);
    if (!role) throw new NotFoundException('Role not found');
    if (role.is_system)
      throw new ForbiddenException('Cannot delete system roles');

    await this.roleRepo.delete(roleId);
  }

  async transferPresidency(
    chapterId: string,
    currentMemberId: string,
    targetMemberId: string,
  ): Promise<void> {
    // ⚡ Bolt: Optimize sequential repository queries using Promise.all
    const [currentMember, targetMember, roles] = await Promise.all([
      this.memberRepo.findById(currentMemberId),
      this.memberRepo.findById(targetMemberId),
      this.roleRepo.findByChapter(chapterId),
    ]);

    if (!currentMember || !targetMember) {
      throw new NotFoundException('Member not found');
    }

    if (targetMember.chapter_id !== chapterId) {
      throw new BadRequestException('Target member is not in this chapter');
    }
    const presidentRole = roles.find(
      (r) => r.is_system && r.permissions.includes(SystemPermissions.WILDCARD),
    );

    if (!presidentRole) {
      throw new NotFoundException('President role not found');
    }

    const currentHasPresident = currentMember.role_ids.includes(
      presidentRole.id,
    );
    if (!currentHasPresident) {
      throw new ForbiddenException(
        'Only the current President can transfer presidency',
      );
    }

    const newCurrentRoles = currentMember.role_ids.filter(
      (id) => id !== presidentRole.id,
    );
    const newTargetRoles = [
      ...new Set([...targetMember.role_ids, presidentRole.id]),
    ];

    // ⚡ Bolt: Optimize sequential repository updates using Promise.all
    await Promise.all([
      this.memberRepo.update(currentMember.id, {
        role_ids: newCurrentRoles,
      }),
      this.memberRepo.update(targetMember.id, { role_ids: newTargetRoles }),
    ]);
  }

  getPermissionsCatalog() {
    return Object.entries(SystemPermissions).map(([key, value]) => ({
      key,
      permission: value,
    }));
  }

  async memberHasAnyPermission(
    chapterId: string,
    userId: string,
    permissions: string[],
  ): Promise<boolean> {
    const member = await this.memberRepo.findByUserAndChapter(
      userId,
      chapterId,
    );
    if (!member?.role_ids?.length) return false;
    const roles = await this.roleRepo.findByIds(member.role_ids);
    const userPermissions = new Set(roles.flatMap((r) => r.permissions));
    if (userPermissions.has('*')) return true;
    return permissions.some((p) => userPermissions.has(p));
  }
}
