import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type {
  FrappSupabaseClient,
  TablesInsert,
  TablesUpdate,
} from '../database.types';
import { PG_UNIQUE_VIOLATION } from '#domain/constants/postgres-error-codes';
import { escapeFilterValue, omitColumns } from '../supabase.utils';
import type {
  CreateChatReportInput,
  CreateChatReportResult,
  HeldObject,
  IChatMessageReportRepository,
  ReportEvidence,
} from '#domain/repositories/chat-moderation.repository.interface';
import type {
  ChatMessageReport,
  ChatMessageReportView,
  ChatReportResolutionStatus,
  ChatReportStatus,
  ReportedAttachment,
} from '#domain/entities/chat-moderation.entity';
import { SupabaseQueryError } from '../supabase-query-error';

/**
 * Rows per page of the hold lookup. A chapter's holding reports are few, so
 * one page is the ordinary case; the loop exists so a long list is still read
 * whole ({@link SupabaseChatMessageReportRepository.findHeldObjects}).
 */
export const HELD_OBJECTS_PAGE_SIZE = 500;

/**
 * `reported_attachments` of a report that holds nothing, as a filter value.
 * Through `.filter()` because the typed `.neq()` wants the column's own type,
 * and this is its JSON text; the database compares it as `jsonb`, which is the
 * predicate `idx_chat_message_reports_evidence_unreleased` is built on.
 */
const HOLDS_NOTHING = '[]';

/** The columns a release or the officer route reads; never the reporter. */
const EVIDENCE_COLUMNS = 'id, chapter_id, status, reported_attachments';

/**
 * Member-filed reports against chat messages (#2257).
 *
 * Every query filters on `chapter_id`. That is not defensive: the officer queue
 * is read by any `channels:manage` holder, and a report id is a bare UUID, so
 * an unscoped `.eq('id', …)` on the resolve path would let an officer in one
 * chapter close another chapter's report. `spec/behavior/multi-tenancy.md`
 * owns the rule; `supabase-chat-message-report.repository.spec.ts` proves it.
 *
 * Every officer read and write also leaves out the reports **about the
 * caller** ({@link notAbout}): an officer can be reported like anyone else,
 * and the queue is where the reporter's note — and, for a DM, the reporter by
 * elimination — lives. Like the chapter predicate it is in the query, not in a
 * caller, so no service path can forget it.
 *
 * The table enables RLS with **zero policies** and the API reaches it through
 * the service-role client, so there is no client-reachable read path at all —
 * which is what makes "a reporter is never discoverable by the reported member"
 * structural rather than a matter of review.
 */
@Injectable()
export class SupabaseChatMessageReportRepository implements IChatMessageReportRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  /**
   * Insert, and translate the partial-unique-index hit into "here is the report
   * you already filed".
   *
   * **Not an upsert, and it cannot be one.** The index is
   * `chat_message_reports_one_open_per_reporter` — unique on
   * `(reporter_user_id, message_id)` *where `status = 'open'`* — and PostgREST
   * will not use a partial unique index as an `ON CONFLICT` arbiter (the same
   * limitation `SupabaseChatMessageRepository.create` documents for the send
   * dedupe). Naming the two columns in `onConflict` would be rejected by
   * Postgres as "no unique or exclusion constraint matching the ON CONFLICT
   * specification", which is a 42P10 surfacing as a 500 on the ordinary path
   * rather than only on the duplicate one.
   *
   * So: insert, and on `23505` re-select the open row. The re-select is scoped
   * to the caller's own `(chapter_id, reporter_user_id, message_id, 'open')`,
   * which is the only tuple the index could have collided on, so it cannot hand
   * back somebody else's report.
   *
   * `created` says which of the two happened, so the service can notify
   * officers about a new report and stay silent on a replay.
   */
  async create(input: CreateChatReportInput): Promise<CreateChatReportResult> {
    const payload: TablesInsert<'chat_message_reports'> = {
      chapter_id: input.chapter_id,
      message_id: input.message_id,
      reporter_user_id: input.reporter_user_id,
      reported_content: input.reported_content,
      reported_sender_id: input.reported_sender_id,
      reported_author_name: input.reported_author_name,
      reported_attachments: input.reported_attachments,
      reason: input.reason,
      details: input.details,
    };

    const { data, error } = await this.supabase
      .from('chat_message_reports')
      .insert(payload)
      .select()
      .single();

    if (error) {
      if (error.code === PG_UNIQUE_VIOLATION) {
        const existing = await this.findOwnOpenReport(
          input.chapter_id,
          input.reporter_user_id,
          input.message_id,
        );
        // A null here means the open report was resolved between the failed
        // insert and this read. Surfacing the original 23505 is the honest
        // answer: the caller can retry and will then succeed, where inventing a
        // row would be a lie about what is in the queue.
        if (existing) return { report: existing, created: false };
      }
      throw new SupabaseQueryError(error);
    }

    return { report: stripReportRow(data), created: true };
  }

  /**
   * Scoped by `chapter_id` as well as `id`, like {@link resolve}: the chapter
   * predicate is what stops a `channels:manage` holder in one chapter from
   * reaching another chapter's report — and, through it, another chapter's
   * message — by UUID. A report about the reviewer is the same `null`.
   */
  async findById(
    id: string,
    chapterId: string,
    reviewerUserId: string,
  ): Promise<ChatMessageReportView | null> {
    const { data, error } = await this.supabase
      .from('chat_message_reports')
      .select()
      .eq('id', id)
      .eq('chapter_id', chapterId)
      .or(notAbout(reviewerUserId))
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data ? stripReportRow(data) : null;
  }

  async findByChapterAndStatus(
    chapterId: string,
    status: ChatReportStatus,
    reviewerUserId: string,
  ): Promise<ChatMessageReportView[]> {
    const { data, error } = await this.supabase
      .from('chat_message_reports')
      .select()
      .eq('chapter_id', chapterId)
      .eq('status', status)
      .or(notAbout(reviewerUserId))
      .order('created_at', { ascending: false });
    if (error) throw new SupabaseQueryError(error);
    return (data ?? []).map(stripReportRow);
  }

  /**
   * Scoped by `chapter_id` as well as `id`, and the chapter predicate is the
   * whole of the tenancy check on this path: `PermissionsGuard` proves the
   * caller holds `channels:manage` *somewhere*, and `ChapterGuard` proves which
   * chapter they are acting in, but neither says anything about which chapter
   * the report in the URL belongs to.
   *
   * **`status = 'open'` makes it a compare-and-set.** Two officers can load the
   * same open report; without the predicate the slower one's Dismiss would
   * overwrite the faster one's `actioned`, and the record would say a removed
   * message was dismissed. The miss is a `null` the service answers with 409.
   *
   * `maybeSingle()` rather than `single()` so a miss is a `null` the service
   * turns into a 404 or 409, not a `PGRST116` surfacing as a 500.
   */
  async resolve(
    id: string,
    chapterId: string,
    status: ChatReportResolutionStatus,
    resolvedBy: string,
    resolvedAt: string,
  ): Promise<ChatMessageReportView | null> {
    const { data, error } = await this.supabase
      .from('chat_message_reports')
      .update(resolutionPatch(status, resolvedBy, resolvedAt))
      .eq('id', id)
      .eq('chapter_id', chapterId)
      .eq('status', 'open')
      .or(notAbout(resolvedBy))
      .select()
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data ? stripReportRow(data) : null;
  }

  /**
   * One `UPDATE … WHERE chapter_id AND message_id AND status = 'open'`, so the
   * set it closes is decided by Postgres at write time rather than by a read
   * the caller took earlier. Scoped by chapter like everything here; a message
   * id is a bare UUID too.
   */
  async resolveOpenForMessage(
    chapterId: string,
    messageId: string,
    status: ChatReportResolutionStatus,
    resolvedBy: string,
    resolvedAt: string,
  ): Promise<ChatMessageReportView[]> {
    const { data, error } = await this.supabase
      .from('chat_message_reports')
      .update(resolutionPatch(status, resolvedBy, resolvedAt))
      .eq('chapter_id', chapterId)
      .eq('message_id', messageId)
      .eq('status', 'open')
      .or(notAbout(resolvedBy))
      .select();
    if (error) throw new SupabaseQueryError(error);
    return (data ?? []).map(stripReportRow);
  }

  /**
   * Undo a removal's claim, matching its whole stamp (see the interface for
   * why this is not a reopen). `actioned` + `resolved_by` + `resolved_at` in
   * the predicate means it can only withdraw the write the same request made:
   * a report some other decision closed does not match, and stays closed.
   */
  async releaseClaim(
    id: string,
    chapterId: string,
    resolvedBy: string,
    resolvedAt: string,
  ): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('chat_message_reports')
      .update({
        status: 'open',
        resolved_at: null,
        resolved_by: null,
        evidence_released_at: null,
      })
      .eq('id', id)
      .eq('chapter_id', chapterId)
      .eq('status', 'actioned')
      .eq('resolved_by', resolvedBy)
      .eq('resolved_at', resolvedAt)
      .select('id')
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data !== null;
  }

  /**
   * `actioned` with `resolved_by` NULL: no officer decided it, the message was
   * already gone. Conditional on `status = 'open'`, so a removal's sweep that
   * reached the row first keeps its own stamp.
   */
  async closeForDeletedMessage(
    id: string,
    chapterId: string,
    resolvedAt: string,
  ): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('chat_message_reports')
      .update({
        status: 'actioned',
        resolved_at: resolvedAt,
        resolved_by: null,
      })
      .eq('id', id)
      .eq('chapter_id', chapterId)
      .eq('status', 'open')
      .select('id')
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data !== null;
  }

  /**
   * The caller's own open report on one message: read back after a unique
   * violation, and asked directly when the message is already deleted
   * (`ChatReportService.fileReport` checks the replay before refusing).
   *
   * Scoped to `(chapter_id, reporter_user_id, message_id, 'open')`, which is
   * the tuple the partial unique index covers, so it cannot hand back
   * somebody else's report. `reporterUserId` is the authenticated caller at
   * every call site; the interface says why that, rather than keeping this
   * method private, is the boundary.
   */
  async findOwnOpenReport(
    chapterId: string,
    reporterUserId: string,
    messageId: string,
  ): Promise<ChatMessageReportView | null> {
    const { data, error } = await this.supabase
      .from('chat_message_reports')
      .select()
      .eq('chapter_id', chapterId)
      .eq('reporter_user_id', reporterUserId)
      .eq('message_id', messageId)
      .eq('status', 'open')
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data ? stripReportRow(data) : null;
  }

  /**
   * Paged by `id` (`id > last`), read until a page comes back empty; the
   * interface says why neither offsets nor a short page will do. Only reports
   * holding something and not yet released are read, through
   * `idx_chat_message_reports_evidence_held`.
   */
  async findHeldObjects(
    chapterId: string,
    excludingReportIds: readonly string[] = [],
  ): Promise<HeldObject[]> {
    const excluded = new Set(excludingReportIds);
    const held = new Map<string, HeldObject>();
    let after: string | null = null;
    for (;;) {
      let page = this.supabase
        .from('chat_message_reports')
        .select('id, status, resolved_at, reported_attachments')
        .eq('chapter_id', chapterId)
        .is('evidence_released_at', null)
        .filter('reported_attachments', 'neq', HOLDS_NOTHING);
      if (after !== null) page = page.gt('id', after);
      const { data, error } = await page
        .order('id', { ascending: true })
        .limit(HELD_OBJECTS_PAGE_SIZE);
      if (error) throw new SupabaseQueryError(error);
      const rows = data ?? [];
      if (rows.length === 0) return [...held.values()];
      for (const row of rows) {
        if (excluded.has(row.id)) continue;
        const open = row.status === 'open';
        const pendingSince = open ? null : row.resolved_at;
        for (const { bucket, storage_path } of readAttachments(
          row.reported_attachments,
        )) {
          const key = `${bucket} ${storage_path}`;
          const known = held.get(key);
          if (!known) {
            held.set(key, {
              bucket,
              storage_path,
              heldOpen: open,
              pendingSince,
            });
            continue;
          }
          known.heldOpen ||= open;
          known.pendingSince = latest(known.pendingSince, pendingSince);
        }
      }
      after = rows[rows.length - 1].id;
    }
  }

  async findEvidence(
    id: string,
    chapterId: string,
    reviewerUserId: string,
  ): Promise<ReportEvidence | null> {
    const { data, error } = await this.supabase
      .from('chat_message_reports')
      .select(EVIDENCE_COLUMNS)
      .eq('id', id)
      .eq('chapter_id', chapterId)
      .or(notAbout(reviewerUserId))
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data ? toEvidence(data) : null;
  }

  async findPendingRelease(
    chapterId: string,
    ids: readonly string[],
  ): Promise<ReportEvidence[]> {
    if (ids.length === 0) return [];
    const { data, error } = await this.supabase
      .from('chat_message_reports')
      .select(EVIDENCE_COLUMNS)
      .eq('chapter_id', chapterId)
      .in('id', [...ids])
      .neq('status', 'open')
      .is('evidence_released_at', null)
      .filter('reported_attachments', 'neq', HOLDS_NOTHING);
    if (error) throw new SupabaseQueryError(error);
    return (data ?? []).map(toEvidence);
  }

  /**
   * Matches `idx_chat_message_reports_evidence_unreleased`, keyed and filtered
   * the same way, so a page is as small as the backlog of releases that have
   * not finished.
   */
  async listPendingRelease(
    resolvedBefore: string,
    limit: number,
    afterId?: string,
  ): Promise<ReportEvidence[]> {
    let page = this.supabase
      .from('chat_message_reports')
      .select(EVIDENCE_COLUMNS)
      .neq('status', 'open')
      .is('evidence_released_at', null)
      .filter('reported_attachments', 'neq', HOLDS_NOTHING)
      .lt('resolved_at', resolvedBefore);
    if (afterId !== undefined) page = page.gt('id', afterId);
    const { data, error } = await page
      .order('id', { ascending: true })
      .limit(limit);
    if (error) throw new SupabaseQueryError(error);
    return (data ?? []).map(toEvidence);
  }

  async markEvidenceReleased(
    id: string,
    chapterId: string,
    releasedAt: string,
  ): Promise<void> {
    const { error } = await this.supabase
      .from('chat_message_reports')
      .update({ evidence_released_at: releasedAt })
      .eq('id', id)
      .eq('chapter_id', chapterId)
      .neq('status', 'open');
    if (error) throw new SupabaseQueryError(error);
  }
}

/**
 * A report's `reported_attachments` as the API wrote it, read defensively: the
 * CHECK guarantees an array, not its elements, and an element without a
 * bucket and a path names no object. Dropping it is safe in both directions
 * it is used — a hold that names nothing protects nothing, and a release or a
 * signature has nothing to reach.
 */
function readAttachments(value: unknown): ReportedAttachment[] {
  if (!Array.isArray(value)) return [];
  const attachments: ReportedAttachment[] = [];
  for (const item of value as unknown[]) {
    if (!item || typeof item !== 'object') continue;
    const { bucket, storage_path, filename, content_type, byte_size } =
      item as Record<string, unknown>;
    if (typeof bucket !== 'string' || typeof storage_path !== 'string') {
      continue;
    }
    attachments.push({
      bucket,
      storage_path,
      filename: typeof filename === 'string' ? filename : '',
      content_type: typeof content_type === 'string' ? content_type : null,
      byte_size: typeof byte_size === 'number' ? byte_size : null,
    });
  }
  return attachments;
}

/** The later of two timestamps, either of which may be missing. */
function latest(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return Date.parse(b) > Date.parse(a) ? b : a;
}

function toEvidence(
  row: Pick<
    ChatMessageReport,
    'id' | 'chapter_id' | 'status' | 'reported_attachments'
  >,
): ReportEvidence {
  return {
    id: row.id,
    chapter_id: row.chapter_id,
    status: row.status,
    reported_attachments: readAttachments(row.reported_attachments),
  };
}

/**
 * The PostgREST `.or()` filter that leaves out reports about `userId`.
 *
 * Spelled as `is null OR <> userId`, not a bare `.neq()`, because
 * `reported_sender_id` is NULL for an imported archive message whose author
 * has not linked their Discord account (#2878; linking sets it), and
 * `NULL <> x` is not true — a bare `.neq()` would silently drop every report
 * on an imported message from the queue. `userId` is the authenticated
 * caller's `users.id`, never client input; it is quoted anyway, as every
 * `.or()` string here is.
 */
function notAbout(userId: string): string {
  const quoted = escapeFilterValue(userId);
  return `reported_sender_id.is.null,reported_sender_id.neq.${quoted}`;
}

function resolutionPatch(
  status: ChatReportResolutionStatus,
  resolvedBy: string,
  resolvedAt: string,
): TablesUpdate<'chat_message_reports'> {
  return { status, resolved_at: resolvedAt, resolved_by: resolvedBy };
}

/**
 * Drops `reporter_user_id` on every exit from this repository, mirroring
 * `stripBookmarkRow`.
 *
 * **A disclosure boundary, not tidiness.** There is no
 * `ClassSerializerInterceptor` registered anywhere in this app, so a DTO is
 * OpenAPI documentation and nothing more — anything not stripped here ships on
 * the wire whatever `ChatReportDto` declares. The officer queue is chapter-wide
 * and an officer can be reported like anybody else, so a row carrying the
 * reporter's id would answer "who reported me" for exactly the member with the
 * most leverage to retaliate. `spec/behavior/chat/README.md`: "There is no
 * surface, API route, or repository method that answers 'who reported me'."
 */
function stripReportRow(row: Record<string, unknown>): ChatMessageReportView {
  // The held attachments leave as summaries, without their storage location
  // (#2481): the queue names the files, and an officer reaches the bytes only
  // through the report's own signing route. The release stamp is the API's
  // bookkeeping. The same boundary as the reporter: nothing here is filtered
  // on the way out by anything else.
  const rest = omitColumns<Record<string, unknown>>(row, [
    'reporter_user_id',
    'evidence_released_at',
  ]);
  rest.reported_attachments = readAttachments(row.reported_attachments).map(
    ({ filename, content_type, byte_size }) => ({
      filename,
      content_type,
      byte_size,
    }),
  );
  return rest as unknown as ChatMessageReportView;
}
