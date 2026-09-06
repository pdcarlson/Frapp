import {
  Inject,
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { MEMBER_REPOSITORY } from '#domain/repositories/member.repository.interface';
import type { IMemberRepository } from '#domain/repositories/member.repository.interface';
import { USER_REPOSITORY } from '#domain/repositories/user.repository.interface';
import type { IUserRepository } from '#domain/repositories/user.repository.interface';
import { ROLE_REPOSITORY } from '#domain/repositories/role.repository.interface';
import type { IRoleRepository } from '#domain/repositories/role.repository.interface';
import { Member } from '#domain/entities/member.entity';
import { User } from '#domain/entities/user.entity';
import {
  SystemPermissions,
  SystemRoleKeys,
} from '#domain/constants/permissions';
import { CustomFieldService } from './custom-field.service';
import { CustomRoleService } from './custom-role.service';
import { RbacService } from './rbac.service';
import { ChapterAuditLogService } from './chapter-audit-log.service';
import { allowedVisibilities } from './custom-field-visibility';
import type { MemberCustomFieldValue } from '#domain/entities/chapter-custom-field.entity';
import { STORAGE_PROVIDER } from '#domain/adapters/storage.interface';
import type { IStorageProvider } from '#domain/adapters/storage.interface';
import {
  PROFILES_BUCKET,
  profileFolderPrefix,
} from '#domain/constants/storage';

export interface AlumniFilter {
  graduation_year?: number;
  city?: string;
  company?: string;
}

export interface MemberProfile {
  id: string;
  user_id: string;
  chapter_id: string;
  role_ids: string[];
  custom_role_ids: string[];
  has_completed_onboarding: boolean;
  created_at: string;
  updated_at: string;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  graduation_year: number | null;
  current_city: string | null;
  current_company: string | null;
  email: string;
  /**
   * Custom-field values, present only on single-member reads
   * (`findProfileById`) and already filtered to the fields the requesting
   * viewer may see. Omitted from list responses.
   */
  custom_fields?: MemberCustomFieldValue[];
}

export type MemberSummary = MemberProfile;

/**
 * One roster row: enough to render a name and an avatar, and nothing else.
 * Keyed by `user_id` rather than the membership `id` because every consumer
 * looks up by the id chat carries — `chat_messages.sender_id` and a DM
 * channel's `member_ids` are both `users.id`.
 */
export interface MemberRosterEntry {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
}

/** A {@link MemberRosterEntry} plus the membership's join timestamp. */
export interface RecentMemberJoin extends MemberRosterEntry {
  joined_at: string;
}

@Injectable()
export class MemberService {
  constructor(
    @Inject(MEMBER_REPOSITORY) private readonly memberRepo: IMemberRepository,
    @Inject(USER_REPOSITORY) private readonly userRepo: IUserRepository,
    @Inject(ROLE_REPOSITORY) private readonly roleRepo: IRoleRepository,
    private readonly customFieldService: CustomFieldService,
    private readonly customRoleService: CustomRoleService,
    private readonly rbacService: RbacService,
    private readonly auditLogService: ChapterAuditLogService,
    @Inject(STORAGE_PROVIDER)
    private readonly storageProvider: IStorageProvider,
  ) {}

  async findByChapter(chapterId: string): Promise<MemberSummary[]> {
    const members = await this.memberRepo.findByChapter(chapterId);
    if (!members.length) return [];

    const userIds = [...new Set(members.map((member) => member.user_id))];
    const users = await this.userRepo.findByIds(userIds);
    const userMap = new Map(users.map((user) => [user.id, user]));

    return members.map((member) => {
      const user = userMap.get(member.user_id);
      if (!user) {
        throw new NotFoundException(
          `User not found for member ${member.id} in chapter ${chapterId}`,
        );
      }
      return this.mergeMemberWithUser(member, user);
    });
  }

  async findProfilesByChapter(chapterId: string): Promise<MemberProfile[]> {
    return this.findByChapter(chapterId);
  }

  /**
   * The chapter roster projected to display fields only.
   *
   * Exists so a display surface can resolve a `users.id` to something human
   * without pulling {@link MemberProfile}, which carries `email`, `bio`,
   * `graduation_year`, `current_city` and `current_company`. Chat resolves
   * author names and DM titles on the client, so the fat profile would put the
   * whole chapter's contact details on every member's device to render a name
   * (#1000, and the over-fetch #986 objects to).
   *
   * Costs the membership read plus one chunked user read per `ID_CHUNK_SIZE`
   * ids — two round trips for a chapter up to 100 members, three up to 200 —
   * and the chunks go out concurrently, so latency stays near one. Note the
   * membership read is still `select('*')` and only `user_id` is used from it;
   * narrowing that is separate work.
   *
   * Unlike {@link findByChapter} a member whose user row is missing is skipped
   * rather than thrown on: one orphaned membership row must not 500 the entire
   * chat surface.
   */
  async findRosterByChapter(chapterId: string): Promise<MemberRosterEntry[]> {
    const members = await this.memberRepo.findByChapter(chapterId);
    if (!members.length) return [];

    const userIds = [...new Set(members.map((member) => member.user_id))];
    const identities = await this.userRepo.findDisplayIdentitiesByIds(userIds);
    const byId = new Map(identities.map((user) => [user.id, user]));

    const roster: MemberRosterEntry[] = [];
    for (const userId of userIds) {
      const user = byId.get(userId);
      if (!user) continue;
      roster.push({
        user_id: user.id,
        display_name: user.display_name,
        avatar_url: user.avatar_url,
      });
    }
    return roster;
  }

  /**
   * The full roster, each entry also carrying its membership join timestamp —
   * for the Activity Feed (`spec/behavior/activity-feed.md`), which needs
   * both a `user_id → {display_name, avatar_url}` lookup (to name the actor
   * behind a backwork upload or announcement) *and* the most recently joined
   * members, from one caller. Built as one combined method rather than two —
   * {@link findRosterByChapter} plus a separate recent-joins query — so that
   * caller does one membership read and one identity batch, not two of each.
   *
   * `Member.created_at` is the membership row's timestamp, i.e. when this
   * person joined *this chapter* — not `users.created_at`, which is account
   * creation and could predate the membership by any amount (a re-join, an
   * alumni account reactivated years later).
   */
  async findRosterWithJoinDates(
    chapterId: string,
  ): Promise<RecentMemberJoin[]> {
    const members = await this.memberRepo.findByChapter(chapterId);
    if (!members.length) return [];

    const userIds = [...new Set(members.map((member) => member.user_id))];
    const identities = await this.userRepo.findDisplayIdentitiesByIds(userIds);
    const byId = new Map(identities.map((user) => [user.id, user]));

    const roster: RecentMemberJoin[] = [];
    for (const member of members) {
      const user = byId.get(member.user_id);
      if (!user) continue;
      roster.push({
        user_id: user.id,
        display_name: user.display_name,
        avatar_url: user.avatar_url,
        joined_at: member.created_at,
      });
    }
    return roster;
  }

  async findByUserAndChapter(
    userId: string,
    chapterId: string,
  ): Promise<Member> {
    const member = await this.memberRepo.findByUserAndChapter(
      userId,
      chapterId,
    );
    if (!member) throw new NotFoundException('Member not found');
    return member;
  }

  async updateRoles(
    memberId: string,
    roleIds: string[],
    chapterId: string,
    customRoleIds?: string[],
  ): Promise<Member> {
    const member = await this.memberRepo.findById(memberId);
    if (!member) throw new NotFoundException('Member not found');
    if (member.chapter_id !== chapterId) {
      throw new ForbiddenException('Member not in current chapter');
    }

    // Both validation fetches depend only on the chapter, so run them together.
    const [roles, customRoles] = await Promise.all([
      this.roleRepo.findByChapter(chapterId),
      customRoleIds !== undefined && customRoleIds.length > 0
        ? this.customRoleService.findByIds(customRoleIds, chapterId)
        : Promise.resolve([]),
    ]);

    // Ids the member ALREADY holds are exempt from validation on both role
    // models: deleting a role leaves its id on member rows by design (spec
    // fail-safe — it resolves to no row and grants nothing), and a client
    // echoing that leftover back must not have its whole save rejected.
    const validRoleIds = new Set(roles.map((r) => r.id));
    const heldRoleIds = new Set(member.role_ids);
    const unknownRoleIds = roleIds.filter(
      (id) => !validRoleIds.has(id) && !heldRoleIds.has(id),
    );
    if (unknownRoleIds.length > 0) {
      throw new BadRequestException(
        `Role IDs do not belong to this chapter: ${unknownRoleIds.join(', ')}`,
      );
    }

    // Custom-role ids get the same cross-chapter validation and held-id
    // exemption as live-role ids. The exemption cannot smuggle a foreign id:
    // the held set only ever contains ids that passed this validation before.
    if (customRoleIds !== undefined && customRoleIds.length > 0) {
      const validCustomRoleIds = new Set(customRoles.map((r) => r.id));
      const heldCustomRoleIds = new Set(member.custom_role_ids ?? []);
      const unknownCustomRoleIds = customRoleIds.filter(
        (id) => !validCustomRoleIds.has(id) && !heldCustomRoleIds.has(id),
      );
      if (unknownCustomRoleIds.length > 0) {
        throw new BadRequestException(
          `Custom role IDs do not belong to this chapter: ${unknownCustomRoleIds.join(', ')}`,
        );
      }
    }

    // Wildcard-carrying roles move only through the presidency-transfer flow
    // (RbacService.transferPresidency), which reassigns them atomically and
    // only at the current President's initiative. Keying on the permission
    // rather than the seeded President row also blocks smuggling via any
    // legacy non-system role that carries `*`. Compared as SETS: neither the
    // member row nor the payload is guaranteed duplicate-free, and a
    // length-based comparison would both reject no-op saves and let a
    // duplicated held id mask an addition.
    const wildcardRoleIds = new Set(
      roles
        .filter((r) => r.permissions.includes(SystemPermissions.WILDCARD))
        .map((r) => r.id),
    );
    if (wildcardRoleIds.size > 0) {
      const currentlyHeld = new Set(
        member.role_ids.filter((id) => wildcardRoleIds.has(id)),
      );
      const willHold = new Set(roleIds.filter((id) => wildcardRoleIds.has(id)));
      const changed =
        currentlyHeld.size !== willHold.size ||
        [...currentlyHeld].some((id) => !willHold.has(id));
      if (changed) {
        throw new ForbiddenException(
          'Wildcard-carrying roles cannot be assigned or removed here: move the President role with the presidency-transfer flow, or strip the wildcard from a legacy role via role update first',
        );
      }
    }

    return this.memberRepo.update(memberId, {
      role_ids: roleIds,
      // Omitted → unchanged, so pre-bridge clients that send only `role_ids`
      // never strip a member's custom roles.
      ...(customRoleIds !== undefined
        ? { custom_role_ids: customRoleIds }
        : {}),
    });
  }

  async updateOnboarding(
    memberId: string,
    completed: boolean,
  ): Promise<Member> {
    return this.memberRepo.update(memberId, {
      has_completed_onboarding: completed,
    });
  }

  /**
   * Record that this member has dismissed `moduleKey`'s ops-setup nudge in this
   * chapter (#492). Idempotent: re-dismissing an already-dismissed nudge is a
   * no-op write rather than a duplicate array entry, so a double-click or a
   * retried request cannot grow the column without bound.
   *
   * Read-then-write rather than a Postgres `array_append`, because the repository
   * boundary takes whole column values and the array is at most four entries —
   * the width of `OPS_NUDGE_MODULES`.
   *
   * That does open a lost-update window, and it is **reachable**, not theoretical:
   * dismissing one nudge falls the next one through immediately, putting a fresh
   * dismiss control under the cursor, so two writes can overlap and the later one
   * erases the earlier key. The client closes that path by serializing the
   * writes: `useDismissOpsNudge` carries `scope: { id: 'ops-nudge-dismiss' }`,
   * so TanStack will not start a second dismissal while one with that scope is
   * pending, and the second read therefore sees the first write. Pinned by
   * `packages/hooks/src/use-ops-nudges.spec.tsx`. (An earlier revision disabled
   * the dismiss control instead; that greys out the successor card for the whole
   * retry window and indefinitely offline, which is a dead-end control.)
   * A cross-tab or cross-device race can still lose one, and that is accepted
   * rather than fixed with an RPC: the entire cost is that one already-dismissed
   * card reappears on the next load and is dismissed again. If this column ever
   * carries something a member cannot trivially redo, this needs to become an
   * atomic `array_append` first.
   */
  async dismissOpsNudge(memberId: string, moduleKey: string): Promise<Member> {
    const member = await this.memberRepo.findById(memberId);
    if (!member) throw new NotFoundException('Member not found');

    const dismissed = member.dismissed_ops_nudges ?? [];
    if (dismissed.includes(moduleKey)) return member;

    return this.memberRepo.update(memberId, {
      dismissed_ops_nudges: [...dismissed, moduleKey],
    });
  }

  async remove(
    memberId: string,
    chapterId: string,
    actorUserId: string,
  ): Promise<void> {
    const member = await this.memberRepo.findById(memberId);
    if (!member) throw new NotFoundException('Member not found');
    if (member.chapter_id !== chapterId) {
      throw new ForbiddenException('Member not in current chapter');
    }
    // #711: purge this chapter's profile-photo folder before the row goes.
    // No independent sweep reaps orphaned profile photos (unlike generated
    // report exports, which the 24h retention sweep covers regardless), so a
    // storage failure here throws and blocks the removal — retryable, same
    // as the account-deletion avatar purge — rather than silently orphaning
    // the objects. A missing bucket/prefix is "nothing to purge", not a
    // failure (`IStorageProvider.listFiles`'s own contract).
    //
    // Deliberately ordered before the row delete rather than after, even
    // though the folder prefix itself only needs chapter_id + user_id (both
    // already in hand) and not the row: purging first means the common
    // failure mode — storage errors — never leaves photos behind, at the
    // cost of a narrower one — `memberRepo.delete` failing *after* a
    // successful purge leaves a still-active member with no photo for this
    // chapter until they re-upload. That is judged the better trade: the
    // reverse order (delete row, then purge) would reopen this issue's own
    // bug on every purge failure, permanently, since a member already
    // removed cannot be removed again to retry it.
    const photoFolder = profileFolderPrefix(chapterId, member.user_id);
    const photoPaths = await this.storageProvider.listFiles(
      PROFILES_BUCKET,
      photoFolder,
    );
    if (photoPaths.length > 0) {
      await this.storageProvider.deleteFiles(PROFILES_BUCKET, photoPaths);
    }
    // `avatar_url` is a global column on `users`, not scoped to this
    // chapter — it can point into whatever chapter's folder the photo last
    // uploaded in, including this one, and survives a chapter removal since
    // the user row itself does not. Left alone, a member removed from this
    // chapter but still active in another would render a broken avatar
    // everywhere their profile appears, pointing at an object this purge
    // just deleted. Mirrors `AccountDeletionService.avatarUrlFolder`'s same
    // check, narrowed to "does it point into the folder just purged" since
    // remove() (unlike account deletion) doesn't already know every chapter
    // the user is in.
    const user = await this.userRepo.findById(member.user_id);
    if (user?.avatar_url?.includes(`${photoFolder}/`)) {
      await this.userRepo.update(member.user_id, { avatar_url: null });
    }
    await this.memberRepo.delete(memberId);
    // Written before the orphan-presidency check below, not after: that check
    // deliberately fails loud (spec/behavior/rbac.md's flag is security-load-
    // bearing, so a failure to set it must not be silently swallowed), and
    // this removal's own audit trail must land regardless of whether that
    // later, unrelated check succeeds — the member is already gone either way.
    await this.auditLogService.record({
      chapterId,
      actorUserId,
      action: 'member_removed',
      targetType: 'member',
      targetId: memberId,
      diff: { user_id: member.user_id },
    });
    // Removing the current President is one of the two ways a chapter can be
    // orphaned (spec/behavior/rbac.md § Presidency Transfer "Edge case") — the
    // other is account deletion, flagged from AccountDeletionService. No-ops
    // when this member did not hold the President role.
    await this.rbacService.flagIfPresidentRemoved(
      chapterId,
      member.role_ids,
      actorUserId,
    );
  }

  async findProfileById(
    memberId: string,
    chapterId: string,
    viewerUserId: string,
  ): Promise<MemberProfile> {
    const member = await this.memberRepo.findById(memberId);
    if (!member) throw new NotFoundException('Member not found');
    if (member.chapter_id !== chapterId) {
      throw new ForbiddenException('Member not in current chapter');
    }

    // The user fetch and the viewer's permission resolution are independent
    // (the latter keys off the viewer, not the target member), so run them
    // together rather than serially.
    const [user, permissions] = await Promise.all([
      this.userRepo.findById(member.user_id),
      this.rbacService.getEffectivePermissions(chapterId, viewerUserId),
    ]);
    if (!user) throw new NotFoundException('User not found');

    // Custom-field visibility is enforced server-side: resolve the viewer's
    // allowed visibility tiers from their effective permissions + whether they
    // are this member, then only those fields' values are fetched.
    const allowed = allowedVisibilities(
      permissions,
      member.user_id === viewerUserId,
    );
    const customFields =
      await this.customFieldService.findVisibleValuesForMember(
        chapterId,
        memberId,
        allowed,
      );

    return {
      ...this.mergeMemberWithUser(member, user),
      custom_fields: customFields,
    };
  }

  /**
   * Directory search (#579/#588): name, email, and visibility-scoped
   * custom-field values, per spec/behavior/members.md → Directory. Field
   * values are matched separately from the name/email pass because they need
   * the viewer's resolved visibility tiers rather than a plain substring
   * check on an already-fetched column.
   */
  async searchByChapterAndName(
    chapterId: string,
    query: string,
    viewerUserId: string,
  ): Promise<MemberProfile[]> {
    const members = await this.memberRepo.findByChapter(chapterId);
    if (!members.length) return [];

    const userIds = [...new Set(members.map((m) => m.user_id))];
    const users = await this.userRepo.findByIds(userIds);
    const userMap = new Map(users.map((u) => [u.id, u]));

    const q = query.trim().toLowerCase();
    const nameOrEmailMatchedUserIds = new Set(
      users
        .filter(
          (u) =>
            u.display_name.toLowerCase().includes(q) ||
            u.email.toLowerCase().includes(q),
        )
        .map((u) => u.id),
    );

    const matchedMemberIds = await this.searchCustomFieldMatches(
      chapterId,
      members,
      viewerUserId,
      q,
    );

    const results: MemberProfile[] = [];
    for (const member of members) {
      const user = userMap.get(member.user_id);
      if (!user) continue;
      if (
        nameOrEmailMatchedUserIds.has(user.id) ||
        matchedMemberIds.has(member.id)
      ) {
        results.push(this.mergeMemberWithUser(member, user));
      }
    }
    return results;
  }

  /**
   * Member ids in `members` whose visible custom-field values match `q`,
   * scoped to what `viewerUserId` may see (spec/behavior/members.md →
   * Directory: "a viewer can only match on field values they are permitted
   * to see"). `self`-tier fields only ever match the viewer's own row — a
   * value the viewer cannot read on `GET /members/:id` must never surface
   * another member in search either.
   */
  private async searchCustomFieldMatches(
    chapterId: string,
    members: Member[],
    viewerUserId: string,
    q: string,
  ): Promise<Set<string>> {
    const permissions = await this.rbacService.getEffectivePermissions(
      chapterId,
      viewerUserId,
    );
    // isSelf=true so the caller's own `self`-tier fields are candidates; the
    // per-row self scoping below still restricts a match to their own member id.
    const allowed = allowedVisibilities(permissions, true);
    const fields = await this.customFieldService.findFieldIdsByVisibility(
      chapterId,
      allowed,
    );
    if (!fields.length) return new Set();

    const selfFieldIds = new Set(
      fields.filter((f) => f.visibility === 'self').map((f) => f.id),
    );
    const values = await this.customFieldService.findValuesByFieldIds(
      fields.map((f) => f.id),
    );

    const viewerMemberId = members.find((m) => m.user_id === viewerUserId)?.id;

    const matched = new Set<string>();
    for (const row of values) {
      if (!row.value?.toLowerCase().includes(q)) continue;
      if (selfFieldIds.has(row.field_id)) {
        if (row.member_id === viewerMemberId) matched.add(row.member_id);
      } else {
        matched.add(row.member_id);
      }
    }
    return matched;
  }

  async findAlumniByChapter(
    chapterId: string,
    filter?: AlumniFilter,
  ): Promise<MemberProfile[]> {
    const alumniRole = await this.roleRepo.findByChapterAndSystemKey(
      chapterId,
      SystemRoleKeys.ALUMNI,
    );
    if (!alumniRole) return [];

    const members = await this.memberRepo.findByChapter(chapterId);

    const alumniMembers: Member[] = [];
    const userIdsSet = new Set<string>();
    for (const m of members) {
      if (m.role_ids.includes(alumniRole.id)) {
        alumniMembers.push(m);
        userIdsSet.add(m.user_id);
      }
    }
    if (!alumniMembers.length) return [];

    const userIds = Array.from(userIdsSet);
    const users = await this.userRepo.findByIds(userIds);

    const filteredUsers = users.filter((u) =>
      this.matchesUserFilter(u, filter),
    );
    if (!filteredUsers.length) return [];

    const userMap = new Map(filteredUsers.map((u) => [u.id, u]));

    const results: MemberProfile[] = [];
    for (const member of alumniMembers) {
      const user = userMap.get(member.user_id);
      if (user) {
        results.push(this.mergeMemberWithUser(member, user));
      }
    }
    return results;
  }

  private matchesUserFilter(user: User, filter?: AlumniFilter): boolean {
    if (!filter) return true;
    if (
      filter.graduation_year !== undefined &&
      user.graduation_year !== filter.graduation_year
    ) {
      return false;
    }
    if (filter.city !== undefined) {
      const cityMatch = user.current_city
        ?.toLowerCase()
        .includes(filter.city.toLowerCase());
      if (!cityMatch) return false;
    }
    if (filter.company !== undefined) {
      const companyMatch = user.current_company
        ?.toLowerCase()
        .includes(filter.company.toLowerCase());
      if (!companyMatch) return false;
    }
    return true;
  }

  private mergeMemberWithUser(member: Member, user: User): MemberProfile {
    return {
      ...member,
      display_name: user.display_name,
      avatar_url: user.avatar_url,
      bio: user.bio,
      graduation_year: user.graduation_year,
      current_city: user.current_city,
      current_company: user.current_company,
      email: user.email,
    };
  }
}
