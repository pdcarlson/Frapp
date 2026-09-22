import type {
  ChatMemberBlockRef,
  ChatMessageReportView,
  ChatReportReason,
  ChatReportResolutionStatus,
  ChatReportStatus,
} from '../entities/chat-moderation.entity';

export const CHAT_MESSAGE_REPORT_REPOSITORY = 'CHAT_MESSAGE_REPORT_REPOSITORY';
export const CHAT_MEMBER_BLOCK_REPOSITORY = 'CHAT_MEMBER_BLOCK_REPOSITORY';

/**
 * Everything the repository is allowed to decide about a new report. The
 * `reported_*` fields are the evidence snapshot, resolved by the service from
 * the message row it just authorized — never supplied by the client.
 */
export interface CreateChatReportInput {
  chapter_id: string;
  message_id: string;
  reporter_user_id: string;
  reported_content: string | null;
  reported_sender_id: string | null;
  reported_author_name: string | null;
  reason: ChatReportReason;
  details: string | null;
}

/**
 * What filing a report produced: the report, and whether this call wrote it.
 *
 * `created` exists for one consumer, and it is load-bearing there: the officer
 * notification fires only for a report this call actually inserted
 * (`ChatReportService.fileReport`). Without it a double-tap or an offline retry
 * — which the idempotent path below answers with the *existing* open report —
 * would page every officer a second time for the same report, and a member
 * could re-page the whole moderation team at will by re-filing.
 */
export interface CreateChatReportResult {
  report: ChatMessageReportView;
  /** False when the caller already had an open report on this message and this is it. */
  created: boolean;
}

export interface IChatMessageReportRepository {
  /**
   * File a report, idempotently on the caller's *open* report for this message.
   *
   * The unique index is partial (`where status = 'open'`), and PostgREST will
   * not use a partial unique index as an `ON CONFLICT` arbiter — the same
   * limitation `SupabaseChatMessageRepository.create` documents for the send
   * dedupe. So this cannot be an upsert: the implementation inserts, and on
   * `23505` re-selects the open row and returns it with `created: false`. A
   * double-tap or an offline retry is therefore a no-op rather than a 500.
   */
  create(input: CreateChatReportInput): Promise<CreateChatReportResult>;

  /**
   * One report within a chapter, whatever its status, **as `reviewerUserId`
   * may see it**. Returns `null` when the id does not resolve inside
   * `chapterId`, or when the report is about `reviewerUserId` themselves
   * (`reported_sender_id` is the caller).
   *
   * - **Chapter.** A report id is a bare UUID and the caller's
   *   `channels:manage` says nothing about which chapter it belongs to.
   * - **Not about the reviewer.** An officer can be reported like anybody
   *   else, and a report about them — its reporter's note, and for a DM the
   *   reporter by elimination — is exactly what "the reporter is never
   *   disclosed to the reported member" keeps from them. Both misses are the
   *   same `null`, so the route's 404 does not confirm the report exists.
   *
   * Exists for the officer actions (#2311), where the row is the capability:
   * the caller needs the report's *current* `status` and `message_id`, read
   * fresh, before it may act on the message it names.
   */
  findById(
    id: string,
    chapterId: string,
    reviewerUserId: string,
  ): Promise<ChatMessageReportView | null>;

  /**
   * The officer queue for one chapter as `reviewerUserId` may see it, newest
   * first, filtered to one status. Reports whose `reported_sender_id` is the
   * reviewer are left out, for the reason {@link findById} gives; a report on
   * an imported archive message (`reported_sender_id` NULL) names no Signet
   * member and is always included.
   *
   * Status is required rather than optional so the read always matches
   * `idx_chat_message_reports_chapter_status` — `(chapter_id, status,
   * created_at desc)` — and the queue never sorts in memory as reports
   * accumulate.
   */
  findByChapterAndStatus(
    chapterId: string,
    status: ChatReportStatus,
    reviewerUserId: string,
  ): Promise<ChatMessageReportView[]>;

  /**
   * Resolve one **open** report within a chapter, as a compare-and-set.
   *
   * Returns `null` when no row matched: the id is not in `chapterId`, the
   * report is about `resolvedBy`, or — the case the predicate exists for — it
   * is no longer `open`. Without the status predicate a stale client could
   * overwrite an `actioned` report with `dismissed`, rewriting what the
   * moderation record says happened to the message. The caller tells the
   * three apart with its own read ({@link findById}).
   */
  resolve(
    id: string,
    chapterId: string,
    status: ChatReportResolutionStatus,
    resolvedBy: string,
    resolvedAt: string,
  ): Promise<ChatMessageReportView | null>;

  /**
   * Resolve **every** open report on one message within a chapter, in one
   * statement, and return the rows it changed.
   *
   * For the report-scoped removal (#2311): several members can report the same
   * message, and once it is removed every one of those reports has been acted
   * on. Resolving only the report the officer clicked would leave its siblings
   * open over a message that is already gone. A single conditional `UPDATE`
   * rather than a read-then-loop, so no sibling filed or resolved in between
   * can be missed or overwritten. Reports about `resolvedBy` are excluded like
   * everywhere else, though every report on one message shares its sender.
   */
  resolveOpenForMessage(
    chapterId: string,
    messageId: string,
    status: ChatReportResolutionStatus,
    resolvedBy: string,
    resolvedAt: string,
  ): Promise<ChatMessageReportView[]>;
}

export interface IChatMemberBlockRepository {
  /**
   * The user ids the caller has blocked in this chapter.
   *
   * Ids rather than rows: this is read on the chat hot path to build the
   * masking set, and it is also what `GET /v1/chat/blocks` serves so a client
   * can apply the same list to rows the server never saw (the Realtime echo).
   */
  findBlockedUserIds(
    chapterId: string,
    blockerUserId: string,
  ): Promise<string[]>;

  /**
   * Of `candidateBlockerUserIds`, the ones who have blocked `blockedUserId` in
   * this chapter.
   *
   * **The inverse question, and it is only askable because of the third
   * argument.** "Who has blocked me" must have no answer — a symmetric read is
   * exactly the oracle `spec/behavior/chat/README.md` forbids — so this never
   * enumerates blockers. It intersects with a candidate set the *caller* already
   * holds for another reason, and it exists for one such caller: the push
   * worker, whose audience is a channel's readable membership and which must
   * drop a recipient who has blocked the sender before any notification is
   * built. A push is content on a lock screen and a persisted notification row,
   * past every client-side list, so filtering the audience is the only place
   * that can be done.
   *
   * It is **not** reachable from any route, and nothing may make it so: no
   * controller takes a `blocked_user_id`, and adding one would turn this into
   * the enumeration the feature is built to prevent.
   *
   * Returns a set rather than rows: the answer is a membership test, and a row
   * would carry `blocker_user_id` into a caller that has no business holding it
   * beyond the filter.
   */
  findBlockersAmong(
    chapterId: string,
    blockedUserId: string,
    candidateBlockerUserIds: string[],
  ): Promise<Set<string>>;

  /**
   * Block a member, idempotently.
   *
   * `(chapter_id, blocker_user_id, blocked_user_id)` is a plain unique
   * constraint — not a partial index — so this one *can* be an upsert with that
   * conflict target, and a repeat returns the existing row with its original
   * `created_at`.
   */
  create(
    chapterId: string,
    blockerUserId: string,
    blockedUserId: string,
  ): Promise<ChatMemberBlockRef>;

  /**
   * Remove the caller's own block. A no-op when there wasn't one — every
   * outcome is the same 204, because a status that distinguished "was blocked"
   * from "wasn't" is an oracle on a feature whose whole point is silence.
   */
  delete(
    chapterId: string,
    blockerUserId: string,
    blockedUserId: string,
  ): Promise<void>;
}
