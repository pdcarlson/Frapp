import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type {
  FrappSupabaseClient,
  TablesInsert,
  TablesUpdate,
} from '../database.types';
import { ITaskRepository } from '#domain/repositories/task.repository.interface';
import {
  Task,
  TaskStatus,
  type TaskSubtask,
} from '#domain/entities/task.entity';
import { SupabaseQueryError } from '../supabase-query-error';

/** Task ids per subtask read: 100 uuids keep the URL near 4 KB. */
const SUBTASK_READ_BATCH = 100;

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

  async findByChapter(chapterId: string): Promise<Task[]> {
    const { data, error } = await this.supabase
      .from('tasks')
      .select('*')
      .eq('chapter_id', chapterId)
      .order('created_at', { ascending: false });
    if (error) throw new SupabaseQueryError(error);
    return data || [];
  }

  async findByAssignee(chapterId: string, assigneeId: string): Promise<Task[]> {
    const { data, error } = await this.supabase
      .from('tasks')
      .select('*')
      .eq('chapter_id', chapterId)
      .eq('assignee_id', assigneeId)
      .order('created_at', { ascending: false });
    if (error) throw new SupabaseQueryError(error);
    return data || [];
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
