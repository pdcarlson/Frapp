import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type {
  FrappSupabaseClient,
  TablesInsert,
  TablesUpdate,
} from '../database.types';
import { PG_UNIQUE_VIOLATION } from '#domain/constants/postgres-error-codes';
import { escapeFilterValue } from '../supabase.utils';
import type {
  CreateChatReportInput,
  CreateChatReportResult,
  IChatMessageReportRepository,
} from '#domain/repositories/chat-moderation.repository.interface';
import type {
  ChatMessageReportView,
  ChatReportResolutionStatus,
  ChatReportStatus,
} from '#domain/entities/chat-moderation.entity';

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
        const existing = await this.findOpenReport(
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
      throw error;
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
    if (error) throw error;
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
    if (error) throw error;
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
    if (error) throw error;
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
    if (error) throw error;
    return (data ?? []).map(stripReportRow);
  }

  /**
   * The caller's own open report on one message, read back after a unique
   * violation.
   *
   * Private, and deliberately not on the repository interface. The interface is
   * the list of questions this table can be asked, and "which of my reports is
   * open on this message" is only safe because `reporter_user_id` is bound to
   * the authenticated caller at the one call site above. Exposing it would make
   * "who reported this message" one argument away.
   */
  private async findOpenReport(
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
    if (error) throw error;
    return data ? stripReportRow(data) : null;
  }
}

/**
 * The PostgREST `.or()` filter that leaves out reports about `userId`.
 *
 * Spelled as `is null OR <> userId`, not a bare `.neq()`, because
 * `reported_sender_id` is NULL for an imported archive message and
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
  // `delete` on a copy rather than a discarded destructuring binding — an
  // unused `_reporterUserId` binding is a lint error here.
  const rest = { ...row };
  delete (rest as { reporter_user_id?: unknown }).reporter_user_id;
  return rest as unknown as ChatMessageReportView;
}
