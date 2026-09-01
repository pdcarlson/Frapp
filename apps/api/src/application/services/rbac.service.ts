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
import { CHAPTER_REPOSITORY } from '../../domain/repositories/chapter.repository.interface';
import type { IChapterRepository } from '../../domain/repositories/chapter.repository.interface';
import { Role } from '../../domain/entities/role.entity';
import { Member } from '../../domain/entities/member.entity';
import {
  SystemPermissions,
  SystemRoleKeys,
  WILDCARD,
} from '../../domain/constants/permissions';
import { flattenPermissionSets } from '../../domain/utils/permissions';
import { CustomRoleService } from './custom-role.service';
import { ChapterAuditLogService } from './chapter-audit-log.service';

/** The chapter's next-highest-ranked role that has at least one live holder,
 * once the (now-vacant) President role is excluded — the pool a presidency
 * claim may be made from. `null` when no other role has any members at all
 * (spec/behavior/rbac.md: "If no suitable member exists, Frapp support
 * intervenes"). */
interface EligibleClaimants {
  role: Role;
  memberIds: Set<string>;
}

@Injectable()
export class RbacService {
  constructor(
    @Inject(ROLE_REPOSITORY) private readonly roleRepo: IRoleRepository,
    @Inject(MEMBER_REPOSITORY) private readonly memberRepo: IMemberRepository,
    @Inject(CHAPTER_REPOSITORY)
    private readonly chapterRepo: IChapterRepository,
    private readonly customRoleService: CustomRoleService,
    private readonly chapterAuditLogService: ChapterAuditLogService,
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
      // A caller-supplied `system_key` would let `roles:manage` mint a role
      // that impersonates a seeded one — claiming ALUMNI would hand its
      // lifecycle restrictions to that role's holders. Custom roles never
      // carry a key.
      system_key: null,
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

    // `system_key` is the identity every authorization and lifecycle lookup
    // resolves on, so it is immutable through the API: moving or clearing it
    // would reintroduce exactly the detach-by-rename hole it was added to
    // close. Renaming a system role stays allowed — it is now only a relabel.
    const updatable = { ...data };
    delete updatable.system_key;

    return this.roleRepo.update(roleId, updatable);
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

    if (currentMember.chapter_id !== chapterId) {
      throw new BadRequestException('Current member is not in this chapter');
    }

    const roles = await this.roleRepo.findByChapter(chapterId);
    const presidentRole = this.findPresidentRole(roles);

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

  /** Resolve the chapter's seeded President role by identity (wildcard-carrying
   * system role) rather than `system_key`, matching {@link transferPresidency}:
   * the legacy `system_key` backfill gap (spec/behavior/rbac.md — a chapter
   * that renamed a system role before the backfill has no key on it) means
   * `system_key` alone cannot be trusted to find every chapter's President. */
  private findPresidentRole(roles: Role[]): Role | undefined {
    return roles.find((r) => r.is_system && r.permissions.includes(WILDCARD));
  }

  /**
   * Walk the chapter's roles by ascending `display_order` (i.e. descending
   * rank), skipping the vacant President role, and return the first role that
   * still has at least one live member holding it. That role's holders are
   * the pool "the next member with the highest-ranked **admin** role" in
   * spec/behavior/rbac.md resolves to — not a hardcoded `SystemRoleKeys` list,
   * since `display_order` is chapter-editable and a chapter may add, rename or
   * reorder roles freely.
   *
   * The walk is floored at the chapter's seeded "Member" role's
   * `display_order` — roles ranked at or below that are the ordinary-member
   * baseline, not an admin tier, and every active chapter has at least one
   * member holding one. Without this floor, a chapter with every officer
   * seat vacant would fall all the way through to "Member" and let any
   * ordinary member (there may be dozens) claim the wildcard. Returns `null`
   * (the support-fallback case) when the chapter's Member role cannot be
   * resolved by `system_key` at all (the legacy backfill gap) — fail closed
   * rather than removing the floor, since this decision grants `*`.
   */
  private async resolveEligibleClaimants(
    chapterId: string,
    roles: Role[],
    presidentRole: Role,
  ): Promise<EligibleClaimants | null> {
    const memberRole = roles.find(
      (r) => r.system_key === SystemRoleKeys.MEMBER,
    );
    if (!memberRole) return null;

    const candidateRoles = roles
      .filter(
        (r) =>
          r.id !== presidentRole.id &&
          r.display_order < memberRole.display_order,
      )
      .sort((a, b) => a.display_order - b.display_order);
    if (!candidateRoles.length) return null;

    const members = await this.memberRepo.findByChapter(chapterId);
    for (const role of candidateRoles) {
      const memberIds = new Set(
        members.filter((m) => m.role_ids.includes(role.id)).map((m) => m.id),
      );
      if (memberIds.size > 0) return { role, memberIds };
    }
    return null;
  }

  /**
   * Set after the member holding the wildcard-carrying President role is
   * removed from the chapter (`MemberService.remove`) or their account is
   * anonymized (`AccountDeletionService`) — the two orphaning causes
   * spec/behavior/rbac.md's Presidency Transfer "Edge case" names. A no-op
   * when the removed member did not hold the President role, or the chapter
   * has none (a chapter mid-onboarding, or one whose seeded roles were
   * otherwise never created).
   *
   * `actorUserId` is null when the caller is the system itself (account
   * deletion has no acting member), matching {@link ChapterAuditLogService}'s
   * contract.
   */
  async flagIfPresidentRemoved(
    chapterId: string,
    removedMemberRoleIds: string[],
    actorUserId: string | null,
  ): Promise<void> {
    if (!removedMemberRoleIds.length) return;

    const roles = await this.roleRepo.findByChapter(chapterId);
    const presidentRole = this.findPresidentRole(roles);
    if (!presidentRole || !removedMemberRoleIds.includes(presidentRole.id)) {
      return;
    }

    await this.chapterRepo.update(chapterId, { needs_president: true });
    await this.chapterAuditLogService.record({
      chapterId,
      actorUserId,
      action: 'president_orphaned',
      targetType: 'chapter',
      targetId: chapterId,
      diff: {},
    });
  }

  /**
   * Whether `memberId` may claim the chapter's vacant presidency right now,
   * for the Roles page's claim banner (rendered to every member, since the
   * eligible claimant is by definition not the outgoing President and is
   * often not a `roles:manage` holder either).
   */
  async getPresidencyClaimStatus(
    chapterId: string,
    memberId: string,
  ): Promise<{
    needs_president: boolean;
    eligible: boolean;
    next_role_name: string | null;
  }> {
    const chapter = await this.chapterRepo.findById(chapterId);
    if (!chapter) throw new NotFoundException('Chapter not found');
    if (!chapter.needs_president) {
      return { needs_president: false, eligible: false, next_role_name: null };
    }

    const roles = await this.roleRepo.findByChapter(chapterId);
    const presidentRole = this.findPresidentRole(roles);
    if (!presidentRole) {
      return { needs_president: true, eligible: false, next_role_name: null };
    }

    const eligible = await this.resolveEligibleClaimants(
      chapterId,
      roles,
      presidentRole,
    );
    return {
      needs_president: true,
      eligible: eligible?.memberIds.has(memberId) ?? false,
      next_role_name: eligible?.role.name ?? null,
    };
  }

  /**
   * Claim the chapter's vacant presidency. Only reachable when
   * `chapters.needs_president` is set and `claimingMemberId` holds the
   * chapter's next-highest-ranked role with a live member — see
   * {@link resolveEligibleClaimants}. The actual role grant is atomic
   * (`claim_presidency` RPC via {@link IMemberRepository.claimPresidencyAtomic}),
   * so two eligible members racing to claim resolve to exactly one winner.
   */
  async claimPresidency(
    chapterId: string,
    claimingMemberId: string,
  ): Promise<void> {
    const chapter = await this.chapterRepo.findById(chapterId);
    if (!chapter) throw new NotFoundException('Chapter not found');
    if (!chapter.needs_president) {
      throw new BadRequestException(
        'This chapter does not need a new President',
      );
    }

    const claimingMember = await this.memberRepo.findById(claimingMemberId);
    if (!claimingMember || claimingMember.chapter_id !== chapterId) {
      throw new NotFoundException('Member not found');
    }

    const roles = await this.roleRepo.findByChapter(chapterId);
    const presidentRole = this.findPresidentRole(roles);
    if (!presidentRole) {
      throw new NotFoundException('President role not found');
    }

    const eligible = await this.resolveEligibleClaimants(
      chapterId,
      roles,
      presidentRole,
    );
    if (!eligible || !eligible.memberIds.has(claimingMemberId)) {
      throw new ForbiddenException(
        "Only a member holding the chapter's next-highest-ranked role can claim the presidency",
      );
    }

    const claimed = await this.memberRepo.claimPresidencyAtomic(
      chapterId,
      claimingMemberId,
      eligible.role.id,
      presidentRole.id,
    );
    if (!claimed) {
      throw new ConflictException(
        'This chapter no longer needs a new President — someone else already claimed it',
      );
    }

    await this.chapterAuditLogService.record({
      chapterId,
      actorUserId: claimingMember.user_id,
      action: 'presidency_claimed',
      targetType: 'chapter',
      targetId: chapterId,
      diff: { claimed_by_member_id: claimingMemberId },
    });
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
   * Id of the chapter's Alumni role, or `null` when it has none. Exposed for
   * callers that classify a batch of members rather than asking about one —
   * e.g. excluding alumni from auto-absent marking — so they resolve the role
   * once instead of per member.
   *
   * Resolves on `system_key`, so renaming the role no longer detaches the
   * lifecycle restrictions from it. `null` now means the role was genuinely
   * never seeded or was renamed *before* the FRA-320 backfill, not merely
   * relabelled.
   */
  async getAlumniRoleId(chapterId: string): Promise<string | null> {
    const alumniRole = await this.roleRepo.findByChapterAndSystemKey(
      chapterId,
      SystemRoleKeys.ALUMNI,
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
