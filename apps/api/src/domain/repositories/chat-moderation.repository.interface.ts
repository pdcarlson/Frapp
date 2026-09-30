import type {
  ChatMemberBlockRef,
  ChatMessageReportView,
  ChatReportReason,
  ChatReportResolutionStatus,
  ChatReportStatus,
  ReportedAttachment,
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
  /** The message's attachments at filing time, held until the report is released (#2481). */
  reported_attachments: ReportedAttachment[];
  reason: ChatReportReason;
  details: string | null;
}

/** One stored object, as a purge and a hold name it. */
export interface StoredObjectRef {
  bucket: string;
  storage_path: string;
}

/** An object reports still hold, and which kind of report holds it. */
export interface HeldObject extends StoredObjectRef {
  /** True when an `open` report is among its holders. */
  heldOpen: boolean;
  /**
   * The latest `resolved_at` among its holders that are resolved but not yet
   * released, or `null` when none is. A release uses it to tell a claim that
   * may still be withdrawn back to `open` (resolved moments ago) from a
   * release that failed long since, which will never reopen.
   */
  pendingSince: string | null;
}

/**
 * The objects one report holds, with where it stands: for the officer route
 * that signs them and for the release that deletes them. Internal to the API —
 * the storage location never leaves it ({@link ChatMessageReportView}).
 */
export interface ReportEvidence {
  id: string;
  chapter_id: string;
  status: ChatReportStatus;
  reported_attachments: ReportedAttachment[];
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
   * The caller's own **open** report on one message, or `null` — the replay
   * {@link create} answers on a unique violation, asked for directly.
   *
   * For the one path where the insert cannot be the question:
   * `ChatReportService.fileReport` refuses a report on a message that is
   * already deleted *before* writing, and a member re-sending a report they
   * filed while the message was live must still get that report back rather
   * than the refusal. So the replay is looked up first.
   *
   * **`reporterUserId` must be the authenticated caller**, exactly as
   * `create`'s `reporter_user_id` is. That, not this interface, is what keeps
   * "who reported this message" unanswerable: `create` already answers "did
   * this user report it" for any id passed to it (the `23505`), so the
   * boundary was never the method list — it is that no route accepts a
   * reporter id and the only call sites thread `@CurrentUser('id')`. The
   * answer is the caller's own report, stripped like every other exit.
   */
  findOwnOpenReport(
    chapterId: string,
    reporterUserId: string,
    messageId: string,
  ): Promise<ChatMessageReportView | null>;

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
   * reviewer are left out, for the reason {@link findById} gives. A report on
   * an imported archive message whose author has not linked their Discord
   * account (`reported_sender_id` NULL) names no Frapp member and is always
   * included; linking sets it to the member (#2878), so a linked author's
   * reports are left out of their own queue like any other.
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

  /**
   * Undo a removal's claim: put one report back to `open` **only if it still
   * carries exactly that claim** — `actioned`, by `resolvedBy`, at
   * `resolvedAt` — and say whether it did.
   *
   * Not a reopen, which the product does not have (`open` is absent from
   * `CHAT_REPORT_RESOLUTION_STATUSES`: the answer to "it happened again" is a
   * new report). It exists for one caller, `ChatReportService`'s
   * report-scoped removal, which claims the report *before* deleting the
   * message so a concurrent Dismiss cannot slip in between (#2311); when the
   * delete then fails, the claim is a false statement — `actioned` over a
   * message still in place — and this withdraws it. Matching the whole stamp
   * means it can only ever withdraw that request's own write: no officer
   * action produces the same `(resolved_by, resolved_at)` pair, and resolution
   * is otherwise one-way.
   *
   * Can fail on the partial unique index if the same reporter filed a new
   * report on the message while the claim stood; the caller logs that rather
   * than failing on it.
   *
   * Clears `evidence_released_at` too. A reopened report holds its evidence
   * again, and a release that ran while the claim stood (the sweep) must not
   * leave it stamped as released — a stamped report is never released again.
   */
  releaseClaim(
    id: string,
    chapterId: string,
    resolvedBy: string,
    resolvedAt: string,
  ): Promise<boolean>;

  /**
   * Close one **open** report as `actioned` with no reviewer (`resolved_by`
   * NULL), and say whether it did.
   *
   * For a report that landed on a message removed while it was being written
   * (`ChatReportService.fileReport`): the removal's sweep had already run, so
   * nothing else would close it, and leaving it open would page every officer
   * about a message that is already gone. No officer decided it, so none is
   * stamped. Scoped by chapter and conditional on `status = 'open'` like every
   * write here.
   */
  closeForDeletedMessage(
    id: string,
    chapterId: string,
    resolvedAt: string,
  ): Promise<boolean>;

  /**
   * Every object a report in this chapter still holds (#2481), for a purge to
   * leave alone and a release to weigh.
   *
   * **A report holds its objects until its release finishes**, not only while
   * it is `open`. It is `evidence_released_at` that ends a hold, not the status:
   * a removal claims its report (`actioned`) before it deletes the message and
   * may withdraw the claim if the delete fails, and a hold that lapsed at the
   * claim would let a delete landing in that window purge the evidence of a
   * report that then reopens. A resolved report whose release failed holds
   * too, until the sweep finishes it. Each object says whether an open report
   * is among its holders (`heldOpen`), and when its latest resolved holder
   * resolved (`pendingSince`).
   *
   * `excludingReportIds` are the reports a release is releasing: they must not
   * hold against themselves.
   *
   * Keyed by object, not by message, because one object can be reached from
   * two messages (#1622: a message can claim another's path, and the Discord
   * importer maps many messages onto one deduplicated object). A hold looked
   * up by the deleted message's id would miss a report on the *other* message,
   * and purge its evidence.
   *
   * Chapter-scoped: an attachment's path lives under its chapter, and a report
   * can only snapshot a message it was authorized to read in its own chapter.
   * Not filtered by viewer — no one views this; it is the purge's question.
   *
   * Paged by key (`id` after the last one read) until a page comes back empty.
   * Not by offset, because a report that stops holding between two page reads
   * would shift every later row down one and skip a holder; and not until a
   * short page, because PostgREST serves `min(limit, max_rows)`. A skipped or
   * truncated answer reads a held object as free and deletes it.
   */
  findHeldObjects(
    chapterId: string,
    excludingReportIds?: readonly string[],
  ): Promise<HeldObject[]>;

  /**
   * One report's evidence **as `reviewerUserId` may see it**, for the officer
   * route that signs it: `null` for another chapter's report, a missing one,
   * or one about the reviewer — the same three misses as {@link findById}.
   */
  findEvidence(
    id: string,
    chapterId: string,
    reviewerUserId: string,
  ): Promise<ReportEvidence | null>;

  /**
   * Of `ids`, the reports in this chapter whose evidence is still to release:
   * no longer `open`, holding at least one object, and not yet stamped
   * released. What a resolution path hands to the release straight after it
   * closes reports.
   */
  findPendingRelease(
    chapterId: string,
    ids: readonly string[],
  ): Promise<ReportEvidence[]>;

  /**
   * The sweep's read, across every chapter: up to `limit` reports resolved
   * before `resolvedBefore` whose evidence is still to release, in `id` order
   * after `afterId` (a page cursor; omit it for the first page).
   *
   * Paged by key rather than taking the oldest few, so a report whose release
   * keeps failing cannot hold a window every tick and starve the rest.
   * `resolvedBefore` keeps the sweep off a removal still in flight, whose
   * claim may yet be withdrawn back to `open`
   * ({@link IChatMessageReportRepository.releaseClaim}).
   */
  listPendingRelease(
    resolvedBefore: string,
    limit: number,
    afterId?: string,
  ): Promise<ReportEvidence[]>;

  /**
   * Stamp one resolved report's evidence as released. Conditional on the
   * report not being `open`: a removal whose claim was withdrawn meanwhile is
   * holding again, and must not be marked released.
   */
  markEvidenceReleased(
    id: string,
    chapterId: string,
    releasedAt: string,
  ): Promise<void>;
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
