/**
 * Member-side moderation state for chat (#2257) — App Store Guideline 1.2.
 *
 * Two tables, one migration (`20260915210000_chat_reports_and_blocks.sql`),
 * one contract (`spec/behavior/chat/README.md` § Report and block). They live
 * in their own entity file rather than in `chat.entity.ts` because neither is
 * part of the message hot path: a report is moderation history and a block is a
 * per-viewer safety control, and the two share nothing with a channel or a
 * message row but a foreign key.
 */

/**
 * The reasons a member can pick from when filing a report.
 *
 * Mirrors `chat_message_reports_reason_check` in the migration. Spelled here as
 * a `const` tuple so the DTO's `@IsIn` and the entity's union come from one
 * list — a value this array admits that the CHECK constraint does not is a
 * 23514 surfacing as a 500.
 */
export const CHAT_REPORT_REASONS = [
  'spam',
  'harassment',
  'hate',
  'violence',
  'sexual',
  'self_harm',
  'other',
] as const;

export type ChatReportReason = (typeof CHAT_REPORT_REASONS)[number];

/**
 * Report lifecycle, mirroring `chat_message_reports_status_check`.
 *
 * `open` is the default the insert relies on and the only status the partial
 * unique index `chat_message_reports_one_open_per_reporter` covers, which is
 * what makes "one *open* report per member per message" the idempotency rule
 * rather than "one report ever".
 */
export const CHAT_REPORT_STATUSES = [
  'open',
  'reviewed',
  'actioned',
  'dismissed',
] as const;

export type ChatReportStatus = (typeof CHAT_REPORT_STATUSES)[number];

/**
 * The statuses an officer may move a report **to**.
 *
 * `open` is absent deliberately: reopening a resolved report would put a second
 * row back under the partial unique index alongside any report filed since it
 * was resolved, and the contract's answer to "it happened again" is a new
 * report, not a revived one.
 */
export const CHAT_REPORT_RESOLUTION_STATUSES = [
  'reviewed',
  'actioned',
  'dismissed',
] as const;

export type ChatReportResolutionStatus =
  (typeof CHAT_REPORT_RESOLUTION_STATUSES)[number];

/**
 * One member's report against one message, as the row exists in the database.
 *
 * `message_id` is nullable and does **not** cascade: a channel delete
 * hard-deletes its messages, and an officer holding `channels:manage` must not
 * be able to erase the reports filed against their own messages by deleting the
 * channel. The `reported_*` columns are what keep such a report actionable —
 * they are a snapshot taken at file time, not a join.
 */
export interface ChatMessageReport {
  id: string;
  chapter_id: string;
  /** Null once the reported message was hard-deleted; the snapshot survives. */
  message_id: string | null;
  reporter_user_id: string;
  /**
   * The message's content **as it read when the report was filed**.
   *
   * Snapshotted because `ChatService.deleteMessage` lets a sender soft-delete
   * their own message, overwriting `content` with `[message deleted]` — without
   * the copy, every reported member would have a one-tap way to blank the
   * evidence and leave an unactionable report in the officer queue.
   */
  reported_content: string | null;
  /** `users.id` of the reported sender, or null for an imported archive row. */
  reported_sender_id: string | null;
  /**
   * The reported author's display name, captured alongside `reported_sender_id`
   * rather than instead of it.
   *
   * `chat_messages` enforces `sender_id is not null or author_name is not null`,
   * so a Discord-imported row names its author here with a NULL `sender_id`.
   * Mirroring only `sender_id` would snapshot nobody for exactly the rows whose
   * message is most likely to be hard-deleted by the import purge.
   */
  reported_author_name: string | null;
  reason: ChatReportReason;
  /** Free text from the reporter, capped at 1000 chars by the CHECK constraint. */
  details: string | null;
  status: ChatReportStatus;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
}

/**
 * What actually leaves the report repository: the row **without**
 * `reporter_user_id`.
 *
 * A separate type rather than reusing {@link ChatMessageReport}, for the same
 * reason `ChatMessageBookmarkRef` exists — the repository strips the column on
 * every exit, and a return type that still promised it would be a lie the
 * compiler enforced.
 *
 * The strip itself is the contract's "the reporter is never disclosed to the
 * reported member" made structural. The officer queue is chapter-wide and a
 * `channels:manage` holder can be reported like anyone else, so a queue that
 * carried the reporter's id would answer "who reported me" for exactly the
 * member best placed to retaliate. An officer needs the evidence, not the
 * reporter.
 */
export type ChatMessageReportView = Omit<ChatMessageReport, 'reporter_user_id'>;

/**
 * One member's block of another, scoped to one chapter.
 *
 * Keyed on `users.id` on both sides because `chat_messages.sender_id` is a
 * `users.id`: the masking predicate is a set membership test against that
 * column, and keying on `members.id` would force a join on every masked read.
 *
 * Unique on `(chapter_id, blocker_user_id, blocked_user_id)`, which is what
 * makes blocking idempotent. Two CHECK constraints keep the pair sane: a member
 * cannot block themselves (the mask would hide their own messages from them),
 * nor the system actor (which would silently mask the welcome post, the
 * `#chapter-audit` bridge and invite-accept DMs with nothing rendering as
 * "blocked" to explain why).
 */
export interface ChatMemberBlock {
  id: string;
  chapter_id: string;
  blocker_user_id: string;
  blocked_user_id: string;
  created_at: string;
}

/**
 * What leaves the block repository: the row **without** `blocker_user_id`.
 *
 * Every row this API serves belongs to the caller, so the field is not news to
 * them — the point is that "who has blocked whom" must never be a field a
 * client can read off a response, because the day a second viewer is added the
 * DTO will still say it is not there. `spec/behavior/chat/README.md` is explicit
 * that a blocked member must not be able to discover the block, and a response
 * shape that has never carried the blocker cannot start leaking it by accident.
 */
export type ChatMemberBlockRef = Omit<ChatMemberBlock, 'blocker_user_id'>;
