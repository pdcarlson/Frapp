import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type {
  FrappSupabaseClient,
  TablesInsert,
  TablesUpdate,
} from '../database.types';
import type {
  ITaskRepository,
  TaskListFilter,
  TaskListQuery,
} from '#domain/repositories/task.repository.interface';
import {
  Task,
  TaskStatus,
  type TaskSubtask,
} from '#domain/entities/task.entity';
import { SupabaseQueryError } from '../supabase-query-error';
import { escapeFilterValue, fetchAllPages } from '../supabase.utils';

/** Task ids per subtask read: 100 uuids keep the URL near 4 KB. */
const SUBTASK_READ_BATCH = 100;

/**
 * Rows per request. PostgREST's default cap; a hosted project set lower still
 * reads every row, in more trips (`fetchAllPages`).
 */
const TASK_PAGE_SIZE = 1000;

@Injectable()
export class SupabaseTaskRepository implements ITaskRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async findById(id: string, chapterId: string): Promise<Task | null> {
    const { data, error } = await this.supabase
      .from('tasks')
      .select('*')
      .eq('id', id)
      .eq('chapter_id', chapterId)
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async findByChapter(
    chapterId: string,
    query: TaskListQuery = {},
  ): Promise<Task[]> {
    const build = () => {
      const q = this.filtered(
        this.supabase.from('tasks').select('*'),
        chapterId,
        query,
      );
      if (query.order === 'longest_waiting') {
        return q
          .order('completed_at', { ascending: true, nullsFirst: false })
          .order('created_at', { ascending: true })
          .order('id', { ascending: true });
      }
      return q
        .order('created_at', { ascending: false })
        .order('id', { ascending: false });
    };

    // Paged even under a `limit`: only an empty page proves the rows ran out
    // (`fetchAllPages`), so a hosted row cap below `limit` still returns a full
    // page, and a caller can read a short page as the last one.
    return fetchAllPages((from, to) => build().range(from, to), {
      pageSize: Math.min(query.limit ?? TASK_PAGE_SIZE, TASK_PAGE_SIZE),
      limit: query.limit,
    });
  }

  async findSince(
    chapterId: string,
    since: { dueFrom: string; createdFrom: string },
  ): Promise<Task[]> {
    return fetchAllPages<Task>(
      (from, to) =>
        this.supabase
          .from('tasks')
          .select('*')
          .eq('chapter_id', chapterId)
          .or(
            `due_date.gte.${since.dueFrom},created_at.gte."${since.createdFrom}"`,
          )
          // A total order: `id` breaks ties, so no row repeats across pages.
          .order('created_at', { ascending: false })
          .order('id', { ascending: true })
          .range(from, to),
      { pageSize: 1000 },
    );
  }

  async countByChapter(
    chapterId: string,
    query: TaskListFilter = {},
  ): Promise<number> {
    const { count, error } = await this.filtered(
      this.supabase.from('tasks').select('id', { count: 'exact', head: true }),
      chapterId,
      query,
    );
    if (error) throw new SupabaseQueryError(error);
    return count ?? 0;
  }

  /** The chapter predicate, then every filter `query` sets, in SQL (#4037). */
  private filtered<
    Q extends {
      eq(column: string, value: unknown): Q;
      neq(column: string, value: unknown): Q;
      is(column: string, value: null): Q;
      not(column: string, operator: string, value: unknown): Q;
      lte(column: string, value: unknown): Q;
      or(filters: string): Q;
    },
  >(q: Q, chapterId: string, query: TaskListFilter & TaskListQuery): Q {
    q = q.eq('chapter_id', chapterId);
    if (query.assigneeId) q = q.eq('assignee_id', query.assigneeId);
    if (query.notAssigneeId) q = q.neq('assignee_id', query.notAssigneeId);
    if (query.createdBy) q = q.eq('created_by', query.createdBy);
    if (query.status) q = q.eq('status', query.status);
    if (query.confirmed === true) q = q.not('confirmed_at', 'is', null);
    if (query.confirmed === false) q = q.is('confirmed_at', null);
    if (query.after) {
      // Strictly after the cursor in (created_at desc, id desc): an earlier
      // `created_at`, or the same one and a lower `id`. Spelled without a
      // nested `and()`: at or before its time, and then either earlier or
      // lower.
      const at = escapeFilterValue(query.after.created_at);
      q = q
        .lte('created_at', query.after.created_at)
        .or(`created_at.lt.${at},id.lt.${escapeFilterValue(query.after.id)}`);
    }
    return q;
  }

  async create(data: TablesInsert<'tasks'>): Promise<Task> {
    const { data: created, error } = await this.supabase
      .from('tasks')
      .insert(data)
      .select()
      .single();

    if (error) throw new SupabaseQueryError(error);
    return created;
  }

  async update(
    id: string,
    chapterId: string,
    data: TablesUpdate<'tasks'>,
  ): Promise<Task> {
    const { data: updated, error } = await this.supabase
      .from('tasks')
      .update(data)
      .eq('id', id)
      .eq('chapter_id', chapterId)
      .select()
      .single();

    if (error) throw new SupabaseQueryError(error);
    return updated;
  }

  async confirmCompletionAtomic(
    id: string,
    chapterId: string,
  ): Promise<Task | null> {
    const { data, error } = await this.supabase.rpc('confirm_task_completion', {
      p_task_id: id,
      p_chapter_id: chapterId,
    });
    if (error) throw new SupabaseQueryError(error);
    const rows = data ?? [];
    return rows.length > 0 ? rows[0] : null;
  }

  async reopenCompletion(
    id: string,
    chapterId: string,
    sentBackAt?: string,
  ): Promise<Task | null> {
    // The filters are the compare-and-set: a confirm that lands first sets
    // `points_awarded`, and then this matches no row rather than leaving a
    // confirmed, point-awarded task back in progress.
    const { data, error } = await this.supabase
      .from('tasks')
      .update({
        status: TaskStatus.IN_PROGRESS,
        completed_at: null,
        ...(sentBackAt ? { sent_back_at: sentBackAt } : {}),
      })
      .eq('id', id)
      .eq('chapter_id', chapterId)
      .eq('status', TaskStatus.COMPLETED)
      .eq('points_awarded', false)
      .select()
      .maybeSingle();

    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async updateUnconfirmed(
    id: string,
    chapterId: string,
    data: TablesUpdate<'tasks'>,
  ): Promise<Task | null> {
    // `points_awarded = false` is the compare-and-set: a confirm that lands
    // between the service's read and this write paid the points on the task
    // as it stood, so the edit matches no row rather than changing it after.
    const { data: updated, error } = await this.supabase
      .from('tasks')
      .update(data)
      .eq('id', id)
      .eq('chapter_id', chapterId)
      .eq('points_awarded', false)
      .select()
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return updated;
  }

  async releaseReminderClaims(
    chapterId: string,
    taskId: string,
  ): Promise<void> {
    const { error } = await this.supabase
      .from('scheduled_notification_dispatches')
      .delete()
      .eq('chapter_id', chapterId)
      .eq('entity_type', 'TASK')
      .eq('entity_id', taskId)
      .in('threshold', ['DUE_SOON', 'OVERDUE']);
    if (error) throw new SupabaseQueryError(error);
  }

  async delete(id: string, chapterId: string): Promise<void> {
    const { error } = await this.supabase
      .from('tasks')
      .delete()
      .eq('id', id)
      .eq('chapter_id', chapterId);

    if (error) throw new SupabaseQueryError(error);
  }

  async findSubtasks(
    chapterId: string,
    taskIds: string[],
  ): Promise<TaskSubtask[]> {
    // In batches, so a chapter-wide list of hundreds of tasks never builds a
    // request URL past what PostgREST accepts.
    const rows: TaskSubtask[] = [];
    for (let i = 0; i < taskIds.length; i += SUBTASK_READ_BATCH) {
      const { data, error } = await this.supabase
        .from('task_subtasks')
        .select('*')
        .eq('chapter_id', chapterId)
        .in('task_id', taskIds.slice(i, i + SUBTASK_READ_BATCH))
        .order('task_id', { ascending: true })
        .order('position', { ascending: true })
        .order('created_at', { ascending: true });
      if (error) throw new SupabaseQueryError(error);
      rows.push(...(data || []));
    }
    return rows;
  }

  async createSubtasks(
    rows: Pick<TaskSubtask, 'task_id' | 'chapter_id' | 'title' | 'position'>[],
  ): Promise<TaskSubtask[]> {
    if (rows.length === 0) return [];
    const { data, error } = await this.supabase
      .from('task_subtasks')
      .insert(rows)
      .select();
    if (error) throw new SupabaseQueryError(error);
    return (data || []).sort((a, b) => a.position - b.position);
  }

  async setSubtaskDone(
    chapterId: string,
    taskId: string,
    subtaskId: string,
    doneAt: string | null,
  ): Promise<TaskSubtask | null> {
    const { data, error } = await this.supabase
      .from('task_subtasks')
      .update({ done_at: doneAt })
      .eq('id', subtaskId)
      .eq('task_id', taskId)
      .eq('chapter_id', chapterId)
      .select()
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async deleteSubtask(
    chapterId: string,
    taskId: string,
    subtaskId: string,
  ): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('task_subtasks')
      .delete()
      .eq('id', subtaskId)
      .eq('task_id', taskId)
      .eq('chapter_id', chapterId)
      .select('id');
    if (error) throw new SupabaseQueryError(error);
    return (data ?? []).length > 0;
  }
}
