/**
 * Payload shapes for rich chat messages (Chunk 05).
 *
 * Kept in `packages/chat-integrations` (zero React deps) so the shape has one
 * home. Renderers live in the apps, not here.
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

/**
 * Payload for a `kind:"points"` card. Built server-side from the committed
 * `point_transactions` row (after `PointsService.adjustPoints` succeeds) so the
 * card can never disagree with the ledger. Names are embedded at write time,
 * keeping the card a correct immutable audit record even if a member later
 * leaves the chapter. Append-only: the card has no actions and is never edited.
 */
export interface PointsPayload {
  /** Admin who ran the command (the message sender). */
  actor_user_id: string;
  actor_name: string;
  /** Member whose balance changed. */
  recipient_user_id: string;
  recipient_name: string;
  /** Signed: `+N` for a grant, `-N` for a deduct. Matches the ledger row. */
  amount: number;
  /** grant → MANUAL (reward), deduct → FINE (penalty). */
  category: "MANUAL" | "FINE";
  reason: string;
  /** `point_transactions.id` of the committed row (audit link). */
  transaction_id: string;
  /** `point_transactions.created_at`. */
  created_at: string;
}

/**
 * Payload for a `kind:"task"` card. Built server-side after `TaskService.create`
 * commits the row (the `/task` slash command), so the card can never assert a
 * task that does not exist. Names are embedded at write time, keeping the
 * assignment snapshot correct even if a member later leaves the chapter.
 *
 * The snapshot is immutable: `status` is always the creation-time `"TODO"`. The
 * card renderer shows the *live* status by reading `task_id` back through the
 * task query — the chat message row is never mutated.
 */
export interface TaskPayload {
  /** `tasks.id` of the committed row — the renderer reads live status from this. */
  task_id: string;
  title: string;
  /** Admin who ran the command (the message sender). */
  assigner_user_id: string;
  assigner_name: string;
  /** Member the task is assigned to. */
  assignee_user_id: string;
  assignee_name: string;
  /** `tasks.due_date` (YYYY-MM-DD). */
  due_date: string;
  /** Creation-time status; always `"TODO"`. Live status comes from the task query. */
  status: "TODO";
  /** Points awarded on confirmed completion, or `null` when none. */
  point_reward: number | null;
  /** `tasks.created_at`. */
  created_at: string;
}

/**
 * Payload for a `kind:"event"` card. Built server-side after
 * `EventService.create` commits the row (the `/event` slash command), so the
 * card can never assert an event that does not exist. Details are embedded at
 * write time as an immutable creation-time snapshot; the renderer reads the
 * *live* attendance count back through the attendance query keyed on `event_id`
 * — the chat message row is never mutated. Server-originated: a client cannot
 * forge `kind:"event"` (see `ChatService.SERVER_ONLY_KINDS`).
 */
export interface EventPayload {
  /** `events.id` of the committed row — the renderer reads live attendance from this. */
  event_id: string;
  name: string;
  /** Event start as an ISO-8601 datetime. */
  start_time: string;
  /** Event end as an ISO-8601 datetime. */
  end_time: string;
  /** Free-text location, or `null` when none was given. */
  location: string | null;
  /** Points awarded on check-in. */
  point_value: number;
  /** Whether attendance is mandatory (always `false` for slash-created events). */
  is_mandatory: boolean;
  /** `events.created_at`. */
  created_at: string;
}

/** Action type used for poll votes. Shared between the renderer and the API. */
export const POLL_VOTE_ACTION_TYPE = "vote";
