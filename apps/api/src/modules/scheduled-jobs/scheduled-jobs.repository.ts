import { Inject, Injectable, Logger } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';

/** Entity families the dispatch log dedups. */
export type DispatchEntityType = 'INVOICE' | 'TASK';

/** Reminder thresholds, one dispatch row per (entity, threshold). */
export type DispatchThreshold = 'DUE_SOON' | 'OVERDUE';

/** Postgres unique-violation. A losing claim, not an error. */
const UNIQUE_VIOLATION = '23505';

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
   * caps how far back a sweep reaches so the query stays indexed on
   * `end_time` and a restarted worker does not re-walk the chapter's entire
   * event history every hour.
   */
  async findEventsPendingAutoAbsent(
    endedAfter: Date,
    endedBefore: Date,
  ): Promise<SweepEventRow[]> {
    const { data, error } = await this.supabase
      .from('events')
      .select('id, chapter_id, end_time')
      .gte('end_time', endedAfter.toISOString())
      .lte('end_time', endedBefore.toISOString())
      .or('is_mandatory.eq.true,required_role_ids.not.is.null');

    if (error) {
      this.logger.error('auto-absent sweep: event lookup failed', error);
      return [];
    }
    return data ?? [];
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
    const { data, error } = await this.supabase
      .from('financial_invoices')
      .select('id, chapter_id, user_id, title, amount, due_date')
      .eq('status', 'OPEN')
      .gte('due_date', dueOnOrAfter)
      .lte('due_date', dueOnOrBefore);

    if (error) {
      this.logger.error('invoice sweep: lookup failed', error);
      return [];
    }
    return data ?? [];
  }

  /** Not-yet-completed tasks with a `due_date` inside the window. */
  async findIncompleteTasksDueBetween(
    dueOnOrAfter: string,
    dueOnOrBefore: string,
  ): Promise<SweepTaskRow[]> {
    const { data, error } = await this.supabase
      .from('tasks')
      .select('id, chapter_id, assignee_id, created_by, title, due_date')
      .in('status', ['TODO', 'IN_PROGRESS', 'OVERDUE'])
      .gte('due_date', dueOnOrAfter)
      .lte('due_date', dueOnOrBefore);

    if (error) {
      this.logger.error('task sweep: lookup failed', error);
      return [];
    }
    return data ?? [];
  }

  /**
   * Claim the right to send one reminder.
   *
   * Returns `true` only for the caller that inserted the row. A unique
   * violation means a previous sweep — or a concurrent replica — already owns
   * this (entity, threshold), so the caller must not send. Any other error is
   * logged and treated as "not claimed": a reminder is skipped rather than
   * risking a duplicate on a write whose outcome is unknown.
   */
  async claimDispatch(
    chapterId: string,
    entityType: DispatchEntityType,
    entityId: string,
    threshold: DispatchThreshold,
  ): Promise<boolean> {
    const { error } = await this.supabase
      .from('scheduled_notification_dispatches')
      .insert({
        chapter_id: chapterId,
        entity_type: entityType,
        entity_id: entityId,
        threshold,
      });

    if (!error) return true;
    if (error.code === UNIQUE_VIOLATION) return false;

    this.logger.error(
      `dispatch claim failed for ${entityType} ${entityId} (${threshold})`,
      error,
    );
    return false;
  }
}
