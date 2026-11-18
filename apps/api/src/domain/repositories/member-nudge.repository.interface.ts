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
  | 'chapter_id'
  | 'user_id'
  | 'kind'
  | 'task_id'
  | 'subject_key'
  | 'written_by'
  | 'expires_at'
> & { title: string; body: string | null; start_here: string | null };

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
  /**
   * Every card this member was already shown that is no longer showing:
   * its subject and kind are not raised again.
   */
  findRaised(
    chapterId: string,
    userId: string,
  ): Promise<Pick<MemberNudge, 'task_id' | 'kind' | 'subject_key'>[]>;
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
  /**
   * Deletes a showing card outright, leaving no record that it was raised:
   * for a card something more pressing replaced before the member acted on
   * it, so it may come back when it is the most pressing again (#5464).
   */
  deleteShowing(chapterId: string, userId: string, id: string): Promise<void>;
  /**
   * Records that the member waved this subject off: the showing card for it
   * is closed `dismissed`, or, for one that was only in the tray, a closed
   * row is written so it is not raised again. Idempotent.
   */
  dismissSubject(
    chapterId: string,
    userId: string,
    subject: Pick<MemberNudge, 'kind' | 'subject_key' | 'task_id'>,
    now: string,
  ): Promise<void>;
  /** Deletes every card of this person's, in every chapter. */
  deleteByUser(userId: string): Promise<void>;

  /**
   * Closes every showing card in the chapter whose time has passed, and
   * deletes its words. For cards whose member never came back to them.
   */
  closeExpired(chapterId: string, now: string): Promise<void>;
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
