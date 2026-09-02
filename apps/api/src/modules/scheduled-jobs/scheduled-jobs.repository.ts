import { Inject, Injectable, Logger } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';
import type {
  FrappSupabaseClient,
  TablesInsert,
} from '../../infrastructure/supabase/database.types';
import { TaskStatus } from '../../domain/entities';

// Re-exported from the entity so the sweep signatures and the typed
// `scheduled_notification_dispatches` row can never drift apart. Kept as
// named exports here because `scheduled-jobs.service.ts` imports them from
// this module.
export type {
  DispatchEntityType,
  DispatchThreshold,
} from '../../domain/entities';
import type {
  DispatchEntityType,
  DispatchThreshold,
} from '../../domain/entities';

/** Postgres unique-violation. A losing claim, not an error. */
const UNIQUE_VIOLATION = '23505';

/**
 * PostgREST caps responses at `max_rows` (1000 — `supabase/config.toml`) and
 * signals truncation with a plain 200 and a null error, so an unpaged sweep
 * query would drop rows silently and permanently. Page through instead, as
 * `SupabasePollVoteRepository` already does.
 *
 * Deliberately **below** `max_rows`, not equal to it. Paging stops on the
 * first short page, so a page size at the cap only works while the two
 * numbers happen to match: lower `max_rows` and every first page comes back
 * short, which reads as "end of results" and silently truncates the sweep —
 * the exact failure the paging exists to prevent. With headroom, a short page
 * unambiguously means the rows ran out.
 */
const SWEEP_PAGE_SIZE = 500;

interface EventCandidateRow {
  id: string;
  chapter_id: string;
  end_time: string;
  is_mandatory: boolean;
  required_role_ids: string[] | null;
}

export interface SweepEventRow {
  id: string;
  chapter_id: string;
  end_time: string;
}

/**
 * An event about to start. Carries the targeting fields because the reminder's
 * audience is resolved per event, and `name`/`start_time` because they are the
 * notification copy.
 */
export interface SweepUpcomingEventRow {
  id: string;
  chapter_id: string;
  name: string;
  start_time: string;
  is_mandatory: boolean;
  required_role_ids: string[] | null;
}

export interface SweepInvoiceRow {
  id: string;
  chapter_id: string;
  user_id: string;
  title: string;
  amount: number;
  due_date: string;
}

export interface SweepTaskRow {
  id: string;
  chapter_id: string;
  assignee_id: string;
  created_by: string;
  title: string;
  due_date: string;
}

interface PollCandidateRow {
  id: string;
  channel_id: string;
  metadata: { question?: string; expires_at?: string } | null;
  chat_channels: { chapter_id: string } | { chapter_id: string }[] | null;
}

export interface SweepPollRow {
  id: string;
  chapter_id: string;
  channel_id: string;
  question: string;
  expires_at: string;
}

/**
 * Data access for the scheduled sweeps.
 *
 * Module-local and service-role scoped, following the `chat-push-worker`
 * precedent: sweeps run across every chapter at once, while every repository
 * under `domain/repositories` is deliberately chapter-scoped. Rather than add
 * a cross-chapter variant to three separate domain repositories, the queries
 * that only the scheduler needs live with the scheduler.
 */
@Injectable()
export class ScheduledJobsRepository {
  private readonly logger = new Logger(ScheduledJobsRepository.name);

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: FrappSupabaseClient,
  ) {}

  /**
   * Events whose check-in grace period has closed and that could require
   * attendance: mandatory, or role-targeted.
   *
   * Bounded on both sides. `endedBefore` is the grace cutoff; `endedAfter`
   * caps how far back a sweep reaches so a restarted worker does not re-walk
   * the chapter's entire event history every hour.
   *
   * Role targeting is filtered here rather than in the query: an event whose
   * `required_role_ids` is `[]` is stored as a non-null empty array, which
   * `not.is.null` would match even though `markAutoAbsent` treats it as
   * untargeted and returns immediately.
   */
  async findEventsPendingAutoAbsent(
    endedAfter: Date,
    endedBefore: Date,
  ): Promise<SweepEventRow[]> {
    const rows = await this.fetchAllPages<EventCandidateRow>(
      'auto-absent sweep: event lookup failed',
      (from, to) =>
        this.supabase
          .from('events')
          .select('id, chapter_id, end_time, is_mandatory, required_role_ids')
          .gte('end_time', endedAfter.toISOString())
          .lte('end_time', endedBefore.toISOString())
          .or('is_mandatory.eq.true,required_role_ids.not.is.null')
          // `id` breaks ties. Offset paging over a non-unique sort key has no
          // guaranteed total order between statements, so events sharing an
          // `end_time` across a page boundary could be returned twice or —
          // worse — skipped entirely.
          .order('end_time', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to),
    );

    return rows
      .filter(
        (row) => row.is_mandatory || (row.required_role_ids?.length ?? 0) > 0,
      )
      .map(({ id, chapter_id, end_time }) => ({ id, chapter_id, end_time }));
  }

  /**
   * Events starting inside `(startAfter, startOnOrBefore]` that could require
   * attendance: mandatory, or role-targeted.
   *
   * The lower bound is **exclusive and is `now`** at every call site, which is
   * what stops a reminder going out about an event that has already begun. A
   * reminder is only ever early, never late.
   *
   * Role targeting is filtered in code rather than in the query for the same
   * reason `findEventsPendingAutoAbsent` does it: a cleared
   * `required_role_ids` is stored as a non-null empty array, which
   * `not.is.null` matches even though nothing is actually targeted.
   */
  async findEventsStartingBetween(
    startAfter: Date,
    startOnOrBefore: Date,
  ): Promise<SweepUpcomingEventRow[]> {
    const rows = await this.fetchAllPages<SweepUpcomingEventRow>(
      'event-reminder sweep: event lookup failed',
      (from, to) =>
        this.supabase
          .from('events')
          .select(
            'id, chapter_id, name, start_time, is_mandatory, required_role_ids',
          )
          .gt('start_time', startAfter.toISOString())
          .lte('start_time', startOnOrBefore.toISOString())
          .or('is_mandatory.eq.true,required_role_ids.not.is.null')
          // `id` breaks ties, for the same reason as the auto-absent sweep:
          // offset paging over a non-unique sort key has no guaranteed total
          // order between statements, so events sharing a `start_time` across
          // a page boundary could be returned twice or skipped entirely.
          .order('start_time', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to),
    );

    return rows.filter(
      (row) => row.is_mandatory || (row.required_role_ids?.length ?? 0) > 0,
    );
  }

  /**
   * OPEN invoices with a `due_date` inside the window. Callers pass dates as
   * `YYYY-MM-DD` because `financial_invoices.due_date` is a `date`, not a
   * timestamp — comparing it against an ISO instant would drag the caller's
   * timezone into the boundary.
   */
  async findOpenInvoicesDueBetween(
    dueOnOrAfter: string,
    dueOnOrBefore: string,
  ): Promise<SweepInvoiceRow[]> {
    return this.fetchAllPages<SweepInvoiceRow>(
      'invoice sweep: lookup failed',
      (from, to) =>
        this.supabase
          .from('financial_invoices')
          .select('id, chapter_id, user_id, title, amount, due_date')
          .eq('status', 'OPEN')
          .gte('due_date', dueOnOrAfter)
          .lte('due_date', dueOnOrBefore)
          .order('id', { ascending: true })
          .range(from, to),
    );
  }

  /** Not-yet-completed tasks with a `due_date` inside the window. */
  async findIncompleteTasksDueBetween(
    dueOnOrAfter: string,
    dueOnOrBefore: string,
  ): Promise<SweepTaskRow[]> {
    return this.fetchAllPages<SweepTaskRow>(
      'task sweep: lookup failed',
      (from, to) =>
        this.supabase
          .from('tasks')
          .select('id, chapter_id, assignee_id, created_by, title, due_date')
          .in('status', [
            TaskStatus.TODO,
            TaskStatus.IN_PROGRESS,
            TaskStatus.OVERDUE,
          ])
          .gte('due_date', dueOnOrAfter)
          .lte('due_date', dueOnOrBefore)
          .order('id', { ascending: true })
          .range(from, to),
    );
  }

  /**
   * Open (not manually closed), not-yet-notified polls whose `expires_at`
   * falls inside the window. `expires_at`/`question` live in `metadata`
   * (there is no dedicated column — see `idx_chat_messages_poll_expires_at`,
   * added by `20260902010000_poll_expiry_dispatch.sql` for this query), and
   * `chapter_id` isn't on `chat_messages` at all — both are read through the
   * same `chat_channels!inner` embed `findPollsByChapter` filters through,
   * mirrored here as a lookup rather than a filter since the sweep runs
   * across every chapter at once.
   */
  async findExpiredPollsPendingNotice(
    expiredAfter: Date,
    expiredBefore: Date,
  ): Promise<SweepPollRow[]> {
    const rows = await this.fetchAllPages<PollCandidateRow>(
      'poll-expiry sweep: lookup failed',
      (from, to) =>
        // Cast at the query boundary: the generated `Database` type has no
        // `Relationships` metadata for `chat_messages` (it's a hand-written
        // `TableDefinition` shim, not full `supabase gen types` output), so
        // supabase-js can't confirm the `chat_channels` embed and infers it
        // as a `SelectQueryError` instead of the real shape. Same fix
        // `search.service.ts` and `supabase-member.repository.ts` use for
        // the same embed-inference gap.
        this.supabase
          .from('chat_messages')
          .select('id, channel_id, metadata, chat_channels!inner(chapter_id)')
          .eq('type', 'POLL')
          .eq('is_deleted', false)
          .is('metadata->>closed_at', null)
          .gte('metadata->>expires_at', expiredAfter.toISOString())
          .lte('metadata->>expires_at', expiredBefore.toISOString())
          .order('id', { ascending: true })
          .range(from, to) as unknown as PromiseLike<{
          data: PollCandidateRow[] | null;
          error: unknown;
        }>,
    );

    return rows
      .map((row): SweepPollRow | null => {
        const chapter = Array.isArray(row.chat_channels)
          ? row.chat_channels[0]
          : row.chat_channels;
        const question = row.metadata?.question;
        const expiresAt = row.metadata?.expires_at;
        if (!chapter || !question || !expiresAt) {
          // Unlike a query error (handled, and retried, by `fetchAllPages`),
          // a row that fails this shape check is dropped for good — it will
          // never satisfy the check on a later tick either. Log it so a
          // malformed POLL row doesn't silently and permanently stop getting
          // its expiry notice with nothing pointing at why.
          this.logger.warn(
            `poll-expiry sweep: dropping malformed POLL row ${row.id} (missing chapter, question, or expires_at)`,
          );
          return null;
        }
        return {
          id: row.id,
          chapter_id: chapter.chapter_id,
          channel_id: row.channel_id,
          question,
          expires_at: expiresAt,
        };
      })
      .filter((row): row is SweepPollRow => row !== null);
  }

  /**
   * Claim the right to send one reminder.
   *
   * Returns `true` only for the caller that inserted the row. A unique
   * violation means a previous sweep — or a concurrent replica — already owns
   * this (entity, threshold, due date), so the caller must not send. Any other
   * error is logged and treated as "not claimed": a reminder is skipped rather
   * than risking a duplicate on a write whose outcome is unknown.
   *
   * `dueDate` is part of the key so rescheduling an entity re-arms its
   * reminders instead of inheriting a stale claim.
   */
  async claimDispatch(
    chapterId: string,
    entityType: DispatchEntityType,
    entityId: string,
    threshold: DispatchThreshold,
    dueDate: string,
  ): Promise<boolean> {
    const row: TablesInsert<'scheduled_notification_dispatches'> = {
      chapter_id: chapterId,
      entity_type: entityType,
      entity_id: entityId,
      threshold,
      due_date: dueDate,
    };
    const { error } = await this.supabase
      .from('scheduled_notification_dispatches')
      .insert(row);

    if (!error) return true;
    if (error.code === UNIQUE_VIOLATION) return false;

    this.logger.error(
      `dispatch claim failed for ${entityType} ${entityId} (${threshold})`,
      error,
    );
    return false;
  }

  /**
   * Release a claim whose send did not happen, so the next sweep retries.
   *
   * Claims are taken *before* sending, which is what stops two replicas from
   * double-notifying. The cost is that a send failing after the claim would
   * suppress that reminder forever, so the caller compensates by releasing.
   * A failed release is not fatal — it degrades to the previous at-most-once
   * behavior for that one reminder.
   *
   * `chapterId` is taken from the same sweep row that claimed the dispatch, not
   * from ambient request context. The unique key on this table is the entity
   * tuple (entity ids are globally unique UUIDs), but the delete still binds
   * `chapter_id` so a compensating release cannot drop another chapter's claim.
   */
  async releaseDispatch(
    chapterId: string,
    entityType: DispatchEntityType,
    entityId: string,
    threshold: DispatchThreshold,
    dueDate: string,
  ): Promise<void> {
    const { error } = await this.supabase
      .from('scheduled_notification_dispatches')
      .delete()
      .eq('chapter_id', chapterId)
      .eq('entity_type', entityType)
      .eq('entity_id', entityId)
      .eq('threshold', threshold)
      .eq('due_date', dueDate);

    if (error) {
      this.logger.error(
        `dispatch release failed for ${entityType} ${entityId} (${threshold}) — this reminder will not be retried`,
        error,
      );
    }
  }

  /**
   * Read every page of a sweep query. Returns `[]` on error: a sweep that
   * cannot read its candidates must not send a partial batch, and the next
   * tick retries.
   */
  private async fetchAllPages<T>(
    errorMessage: string,
    page: (
      from: number,
      to: number,
    ) => PromiseLike<{ data: T[] | null; error: unknown }>,
  ): Promise<T[]> {
    const all: T[] = [];

    for (let from = 0; ; from += SWEEP_PAGE_SIZE) {
      const { data, error } = await page(from, from + SWEEP_PAGE_SIZE - 1);

      if (error) {
        this.logger.error(errorMessage, error);
        return [];
      }

      const rows = data ?? [];
      all.push(...rows);
      if (rows.length < SWEEP_PAGE_SIZE) return all;
    }
  }
}
