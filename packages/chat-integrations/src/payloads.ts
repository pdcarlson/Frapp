/**
 * Payload shapes for rich chat messages (Chunk 05).
 *
 * Kept in `packages/chat-integrations` (zero React deps) so both web and the
 * Edge Function envelope a consistent contract. Renderers in `apps/web` /
 * `apps/mobile` are wired via the kind→renderer registry, but the payload
 * shape is the source of truth here.
 */

export interface PollOption {
  /** Stable id used as the action `payload.option_id` when a user votes. */
  id: string;
  /** Label shown in the card. */
  label: string;
}

export interface PollPayload {
  question: string;
  options: PollOption[];
  /**
   * Wall-clock when the poll closes. ISO-8601 string. Voting is gated
   * client-side; the server has no auto-close — Chunk 10 may add it.
   */
  closes_at: string;
}

export interface AnnouncementPayload {
  body: string;
}

export interface SystemAuditPayload {
  /** The audit row's `action` column. */
  action: string;
  /** The audit row's `actor_user_id`. May be null for system-originated rows. */
  actor_user_id: string | null;
  /** Compact diff: keys with `from`/`to` pairs. Free-form jsonb. */
  diff: Record<string, unknown>;
}

export interface PollVoteActionPayload {
  option_id: string;
}

/** Action type used for poll votes. Shared between renderer + Edge Function. */
export const POLL_VOTE_ACTION_TYPE = "vote";
