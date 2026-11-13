import type { MemberNudgeDismissReason } from '@repo/validation';
import type {
  MemberNudge,
  MemberNudgeSettings,
  MemberNudgeStatus,
} from '../entities/member-nudge.entity';

export const MEMBER_NUDGE_REPOSITORY = 'MEMBER_NUDGE_REPOSITORY';

/** What a new card is made of. It is created showing. */
export type MemberNudgeDraft = Pick<
  MemberNudge,
  'chapter_id' | 'user_id' | 'kind' | 'task_id' | 'written_by' | 'expires_at'
> & { title: string; body: string; start_here: string | null };

/**
 * `member_nudges` and `member_nudge_settings` (#4781). Every read and write
 * names the chapter and the member: the tables have no policies, so nothing
 * else scopes them.
 */
export interface IMemberNudgeRepository {
  /** The card the member is being shown, if any. */
  findShowing(chapterId: string, userId: string): Promise<MemberNudge | null>;
  /** The member's cards created at or after `since`, newest first. */
  findRecent(
    chapterId: string,
    userId: string,
    since: string,
  ): Promise<MemberNudge[]>;
  /** Every `task_id:kind` this member was already shown, ever. */
  findRaised(
    chapterId: string,
    userId: string,
  ): Promise<Pick<MemberNudge, 'task_id' | 'kind'>[]>;
  /**
   * Creates a showing card. Null when the member already has one showing or
   * this task was already raised for this kind (a second device got there
   * first).
   */
  create(draft: MemberNudgeDraft): Promise<MemberNudge | null>;
  /** Sets `seen_at` the first time. A card that is not showing is left alone. */
  markSeen(
    chapterId: string,
    userId: string,
    id: string,
    seenAt: string,
  ): Promise<void>;
  /**
   * Closes a showing card and deletes its words. False when there was no
   * such showing card.
   */
  close(
    chapterId: string,
    userId: string,
    id: string,
    change: {
      status: Exclude<MemberNudgeStatus, 'showing'>;
      dismiss_reason?: MemberNudgeDismissReason;
      closed_at: string;
    },
  ): Promise<boolean>;
  /** Deletes every card of this person's, in every chapter. */
  deleteByUser(userId: string): Promise<void>;
  findSettings(
    chapterId: string,
    userId: string,
  ): Promise<MemberNudgeSettings | null>;
  saveSettings(
    chapterId: string,
    userId: string,
    change: Partial<Pick<MemberNudgeSettings, 'enabled' | 'quiet_until'>>,
    now: string,
  ): Promise<MemberNudgeSettings>;
}
