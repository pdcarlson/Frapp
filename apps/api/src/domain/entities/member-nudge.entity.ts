import type {
  MemberNudgeDismissReason,
  MemberNudgeKind,
} from '@repo/validation';

export type MemberNudgeStatus = 'showing' | 'dismissed' | 'done' | 'expired';

/** Who wrote a card's words: the model, or Frapp's fixed sentence. */
export type MemberNudgeAuthor = 'ai' | 'fixed';

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
  task_id: string;
  title: string | null;
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
