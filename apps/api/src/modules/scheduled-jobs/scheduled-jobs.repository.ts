import { Inject, Injectable, Logger } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';

/** Entity families the dispatch log dedups. */
export type DispatchEntityType = 'INVOICE' | 'TASK' | 'EVENT';

/** Work thresholds, one dispatch row per (entity, threshold, due date). */
export type DispatchThreshold = 'DUE_SOON' | 'OVERDUE' | 'AUTO_ABSENT';

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
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
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
          .in('status', ['TODO', 'IN_PROGRESS', 'OVERDUE'])
          .gte('due_date', dueOnOrAfter)
          .lte('due_date', dueOnOrBefore)
          .order('id', { ascending: true })
          .range(from, to),
    );
  }

  /**
   * Every chapter id, for sweeps that walk a per-chapter storage prefix.
   *
   * Storage cannot supply these: `listObjects` returns only the immediate
   * folder level and drops folder entries, so listing `chapters/` comes back
   * empty and each prefix has to be named explicitly.
   *
   * Unfiltered by subscription status on purpose — a canceled chapter's
   * exports are exactly as stale, and as full of member PII, as an active
   * one's.
   */
  async findAllChapterIds(): Promise<string[]> {
    const rows = await this.fetchAllPages<{ id: string }>(
      'report retention sweep: chapter lookup failed',
      (from, to) =>
        this.supabase
          .from('chapters')
          .select('id')
          .order('id', { ascending: true })
          .range(from, to),
    );
    return rows.map((row) => row.id);
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
    const { error } = await this.supabase
      .from('scheduled_notification_dispatches')
      .insert({
        chapter_id: chapterId,
        entity_type: entityType,
        entity_id: entityId,
        threshold,
        due_date: dueDate,
      });

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
   */
  async releaseDispatch(
    entityType: DispatchEntityType,
    entityId: string,
    threshold: DispatchThreshold,
    dueDate: string,
  ): Promise<void> {
    const { error } = await this.supabase
      .from('scheduled_notification_dispatches')
      .delete()
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
