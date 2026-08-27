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
   * Every member of a chapter as `user_id` + `display_name`, in one query.
   *
   * Kept separate from {@link findByChapter} rather than narrowing it: that one
   * returns `Member` rows and a dozen callers depend on `role_ids`,
   * `custom_role_ids` and onboarding state. This exists for the chat mention
   * path, which needs the opposite — no membership metadata at all, and the
   * display name that lives on `users`.
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
}
