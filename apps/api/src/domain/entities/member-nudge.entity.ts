import type {
  MemberNudgeDismissReason,
  MemberNudgeKind,
} from '@repo/validation';

export type MemberNudgeStatus = 'showing' | 'dismissed' | 'done' | 'expired';

/**
 * Who wrote a card's words: the model, Frapp's fixed sentence (the model's
 * failed a check or could not be reached), or nobody: a `plain` card carries
 * only the thing's own name and time, because AI is off for this member or
 * this server, or its kind is never written (#5464).
 */
export type MemberNudgeAuthor = 'ai' | 'fixed' | 'plain';

/**
 * One card on a member's Activity (`member_nudges`, #4781). The words are
 * kept only while the card shows: a closed row has none, and stays as the
 * record that this task was raised once for this kind.
 */
export interface MemberNudge {
  id: string;
  chapter_id: string;
  user_id: string;
  kind: MemberNudgeKind;
  /** The task a task card is about; null for every other kind. */
  task_id: string | null;
  /**
   * What the card is about, for every kind: a task's or event's id, or a
   * channel and its latest message (`member-nudge-items.ts`). A card is
   * raised once per subject and kind.
   */
  subject_key: string;
  /** A task card's title; any other card's headline when it was raised. */
  title: string | null;
  /**
   * A task card's sentence, or the one sentence AI added to any other card.
   * Null on a showing card that has none (`plain`).
   */
  body: string | null;
  /** "A suggested place to start", or null when the card has none. */
  start_here: string | null;
  written_by: MemberNudgeAuthor;
  status: MemberNudgeStatus;
  dismiss_reason: MemberNudgeDismissReason | null;
  seen_at: string | null;
  created_at: string;
  expires_at: string;
  closed_at: string | null;
}

/** A member's own switch and quiet stretch (`member_nudge_settings`). */
export interface MemberNudgeSettings {
  user_id: string;
  chapter_id: string;
  enabled: boolean;
  quiet_until: string | null;
  updated_at: string;
}
