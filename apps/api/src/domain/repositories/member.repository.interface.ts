import { ChapterMemberIdentity, Member } from '../entities/member.entity';

export const MEMBER_REPOSITORY = 'MEMBER_REPOSITORY';

export interface IMemberRepository {
  findById(id: string): Promise<Member | null>;
  findByUser(userId: string): Promise<Member[]>;
  findByUserAndChapter(
    userId: string,
    chapterId: string,
  ): Promise<Member | null>;
  findByChapter(chapterId: string): Promise<Member[]>;
  /**
   * Every member of a chapter as `user_id` + `display_name` + `role_ids`, in
   * one query (`role_ids` since 2026-11-06, for role mentions).
   *
   * Kept separate from {@link findByChapter} rather than narrowing it: that one
   * returns `Member` rows and a dozen callers depend on `role_ids` and
   * onboarding state. This exists for the chat mention
   * path, which needs the opposite: only the `roles` ids a role mention expands
   * through, and the display name that lives on `users`.
   *
   * **One query, not two.** Resolving `@`-mentions used to walk
   * `findByChapter` → `findByIds`, and the second of those selects `'*'`, so a
   * PII-bearing roster fetch rode the send hot path (#986). The chapter scope
   * lives in the join here, so a caller cannot forget to apply it — which
   * matters more than it looks: passing a wider candidate set would let a
   * member mention someone outside their chapter, and mentions override a
   * per-channel mute in the push rules.
   */
  findChapterMemberIdentities(
    chapterId: string,
  ): Promise<ChapterMemberIdentity[]>;
  create(data: Partial<Member>): Promise<Member>;
  update(id: string, data: Partial<Member>): Promise<Member>;
  /**
   * Write a member's `role_ids` through the `set_member_role_ids` RPC: only
   * when the row still holds `expectedRoleIds` (the value the caller read) and
   * every id it newly gives names a live role of the chapter, under the role
   * locks `delete_role` takes (#4830). Resolves to the written row, or `null`
   * when the row moved or a given role was deleted since the read, so the
   * caller can answer 409.
   */
  setRoleIds(
    chapterId: string,
    memberId: string,
    expectedRoleIds: string[],
    roleIds: string[],
  ): Promise<Member | null>;
  delete(id: string): Promise<void>;
  /**
   * Atomically move the President (wildcard) role from one member to another via
   * the `transfer_presidency` RPC (single DB transaction). Resolves to `true` on
   * success, or `false` when the current member no longer holds the role in the
   * chapter (race lost / stale read) so the caller can surface a 403.
   */
  transferPresidencyAtomic(
    chapterId: string,
    currentMemberId: string,
    targetMemberId: string,
    presidentRoleId: string,
  ): Promise<boolean>;
  /**
   * Atomically claim the vacant President (wildcard) role via the
   * `claim_presidency` RPC (single DB transaction). `eligibleRoleId` is
   * re-verified against the member's current `role_ids` inside the same
   * transaction as the grant, so a role reassignment racing the caller's own
   * eligibility check cannot smuggle an ineligible member into the role.
   * Resolves to `true` on success, or `false` when the chapter no longer
   * needs a new President (race lost — another eligible member already
   * claimed it, or the flag was otherwise cleared) so the caller can surface
   * a 409.
   */
  claimPresidencyAtomic(
    chapterId: string,
    claimingMemberId: string,
    eligibleRoleId: string,
    presidentRoleId: string,
  ): Promise<boolean>;
}
