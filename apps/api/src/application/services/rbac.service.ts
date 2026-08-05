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
import { Member } from '../../domain/entities/member.entity';
import {
  ALUMNI_ROLE_NAME,
  SystemPermissions,
  WILDCARD,
} from '../../domain/constants/permissions';
import { flattenPermissionSets } from '../../domain/utils/permissions';
import { CustomRoleService } from './custom-role.service';

@Injectable()
export class RbacService {
  constructor(
    @Inject(ROLE_REPOSITORY) private readonly roleRepo: IRoleRepository,
    @Inject(MEMBER_REPOSITORY) private readonly memberRepo: IMemberRepository,
    private readonly customRoleService: CustomRoleService,
  ) {}

  async findByChapter(chapterId: string): Promise<Role[]> {
    return this.roleRepo.findByChapter(chapterId);
  }

  async create(chapterId: string, data: Partial<Role>): Promise<Role> {
    // Only the seeded President role may carry the wildcard: letting
    // `roles:manage` mint a new `*` role would bypass the presidency-transfer
    // safeguard entirely (spec/behavior/rbac.md).
    if (data.permissions?.includes(WILDCARD)) {
      throw new BadRequestException(
        'New roles cannot carry the wildcard (*) permission; use the presidency-transfer flow instead',
      );
    }

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

    // An update may keep a wildcard the role already holds (the President
    // role's permissions stay editable) but may never introduce one — that
    // would mint a second wildcard holder outside the transfer flow.
    if (
      data.permissions?.includes(WILDCARD) &&
      !role.permissions.includes(WILDCARD)
    ) {
      throw new BadRequestException(
        'The wildcard (*) permission cannot be added to a role; use the presidency-transfer flow instead',
      );
    }

    // Nor may the seeded President role lose its wildcard: with introduction
    // blocked above, a strip would be unrecoverable through the API and leave
    // the chapter without any wildcard holder (spec/behavior/rbac.md — the
    // President role always carries `*`). Legacy non-system roles carrying a
    // pre-validation `*` stay strippable, as that is their cleanup path.
    if (
      role.is_system &&
      role.permissions.includes(WILDCARD) &&
      data.permissions &&
      !data.permissions.includes(WILDCARD)
    ) {
      throw new BadRequestException(
        'The President role must keep the wildcard (*) permission; use the presidency-transfer flow to move it',
      );
    }

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
    const userPermissions = await this.resolvePermissionSet(chapterId, member);
    if (userPermissions.has(WILDCARD)) return true;
    return permissions.some((p) => userPermissions.has(p));
  }

  /**
   * Whether `userId` holds the chapter's Alumni system role.
   *
   * Alumni are read-mostly: the spec excludes them from points accumulation,
   * event check-in, and study hours, and limits their chat posting to
   * `#alumni` and direct conversations (`spec/behavior/alumni.md`). This is a
   * lifecycle check, not a permission check — holding the role is what
   * restricts, so a member who still needs to act operationally should not
   * carry it.
   *
   * Returns `false` when the chapter has no Alumni role or the caller is not a
   * member, so callers fail open to their normal permission checks rather than
   * locking everyone out of a chapter whose Alumni role was renamed/removed.
   */
  async isAlumni(chapterId: string, userId: string): Promise<boolean> {
    const member = await this.memberRepo.findByUserAndChapter(
      userId,
      chapterId,
    );
    return this.hasAlumniRole(chapterId, member?.role_ids);
  }

  /**
   * {@link isAlumni} for callers that already hold the member's role ids —
   * notably the chat hot path, which looks the member up to decide channel
   * access and must not re-fetch it on every message. Still costs the role
   * lookup itself, so callers should only reach for it when the answer can
   * change the outcome.
   */
  async hasAlumniRole(
    chapterId: string,
    roleIds: string[] | null | undefined,
  ): Promise<boolean> {
    if (!roleIds?.length) return false;

    const alumniRoleId = await this.getAlumniRoleId(chapterId);
    if (!alumniRoleId) return false;

    return roleIds.includes(alumniRoleId);
  }

  /**
   * Id of the chapter's Alumni role, or `null` when it has none (renamed or
   * deleted). Exposed for callers that classify a batch of members rather than
   * asking about one — e.g. excluding alumni from auto-absent marking — so they
   * resolve the role once instead of per member.
   */
  async getAlumniRoleId(chapterId: string): Promise<string | null> {
    const alumniRole = await this.roleRepo.findByChapterAndName(
      chapterId,
      ALUMNI_ROLE_NAME,
    );
    return alumniRole?.id ?? null;
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
    const set = await this.resolvePermissionSet(chapterId, member);
    return Array.from(set).sort();
  }

  /**
   * Flatten a member's live-role permissions and custom-role capabilities
   * (bridge model, spec/behavior/rbac.md) into one set. Both lookups resolve
   * within `chapterId`, so stale or cross-chapter ids contribute nothing.
   * The flatten policy itself (union + wildcard only from live roles) lives
   * in `flattenPermissionSets`, shared with `PermissionsGuard` so the two
   * can never drift.
   */
  private async resolvePermissionSet(
    chapterId: string,
    member: Member | null,
  ): Promise<Set<string>> {
    const roleIds = member?.role_ids ?? [];
    const customRoleIds = member?.custom_role_ids ?? [];
    if (!roleIds.length && !customRoleIds.length) return new Set();

    const [roles, customRoles] = await Promise.all([
      roleIds.length
        ? this.roleRepo.findByIds(roleIds, chapterId)
        : Promise.resolve([]),
      customRoleIds.length
        ? this.customRoleService.findByIds(customRoleIds, chapterId)
        : Promise.resolve([]),
    ]);

    return flattenPermissionSets(
      roles.map((r) => r.permissions),
      customRoles.map((r) => r.capabilities),
    );
  }
}
