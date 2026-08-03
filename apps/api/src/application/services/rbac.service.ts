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

  async update(
    roleId: string,
    chapterId: string,
    data: Partial<Role>,
  ): Promise<Role> {
    const role = await this.roleRepo.findById(roleId);
    if (!role) throw new NotFoundException('Role not found');
    if (role.chapter_id !== chapterId)
      throw new ForbiddenException('Role not in current chapter');

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

  async delete(roleId: string, chapterId: string): Promise<void> {
    const role = await this.roleRepo.findById(roleId);
    if (!role) throw new NotFoundException('Role not found');
    if (role.chapter_id !== chapterId)
      throw new ForbiddenException('Role not in current chapter');
    if (role.is_system)
      throw new ForbiddenException('Cannot delete system roles');

    await this.roleRepo.delete(roleId);
  }

  async transferPresidency(
    chapterId: string,
    currentMemberId: string,
    targetMemberId: string,
  ): Promise<void> {
    if (currentMemberId === targetMemberId) {
      // A self-transfer would strip then re-add the wildcard role on the same
      // row — a no-op the RPC would otherwise report as success.
      throw new BadRequestException(
        'Cannot transfer presidency to the current President',
      );
    }

    const currentMember = await this.memberRepo.findById(currentMemberId);
    const targetMember = await this.memberRepo.findById(targetMemberId);

    if (!currentMember || !targetMember) {
      throw new NotFoundException('Member not found');
    }

    if (targetMember.chapter_id !== chapterId) {
      throw new BadRequestException('Target member is not in this chapter');
    }

    const roles = await this.roleRepo.findByChapter(chapterId);
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

    // Persist the removal from the current President and the addition to the
    // target in a single DB transaction (the `transfer_presidency` RPC), so a
    // partial failure can never leave the chapter with zero or two Presidents.
    const transferred = await this.memberRepo.transferPresidencyAtomic(
      chapterId,
      currentMember.id,
      targetMember.id,
      presidentRole.id,
    );

    // `false` => the current President no longer holds the wildcard role in the
    // chapter (a concurrent transfer already moved it, or the membership was
    // stale between the read above and this write). Same outcome as the
    // in-memory guard: only the current President can transfer presidency.
    if (!transferred) {
      throw new ForbiddenException(
        'Only the current President can transfer presidency',
      );
    }
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
    const roles = await this.roleRepo.findByIds(member.role_ids, chapterId);
    const userPermissions = new Set(roles.flatMap((r) => r.permissions));
    if (userPermissions.has('*')) return true;
    return permissions.some((p) => userPermissions.has(p));
  }

  /**
   * Resolve a caller's effective permission set for a chapter.
   *
   * Mirrors the flattening logic in `PermissionsGuard` so web and mobile
   * clients can render permission-aware UI (hide nav items, disable actions,
   * route users to `/no-access`) without making one request per role or
   * duplicating RBAC rules in client code. Wildcard `*` passes through so the
   * caller can short-circuit rendering for Presidents. Role ids resolve within
   * `chapterId`, as in the guard, so what the client renders can never be
   * widened by a role id belonging to another chapter.
   */
  async getEffectivePermissions(
    chapterId: string,
    userId: string,
  ): Promise<string[]> {
    const member = await this.memberRepo.findByUserAndChapter(
      userId,
      chapterId,
    );
    if (!member?.role_ids?.length) return [];
    const roles = await this.roleRepo.findByIds(member.role_ids, chapterId);
    if (!roles.length) return [];
    const set = new Set(roles.flatMap((r) => r.permissions ?? []));
    return Array.from(set).sort();
  }
}
