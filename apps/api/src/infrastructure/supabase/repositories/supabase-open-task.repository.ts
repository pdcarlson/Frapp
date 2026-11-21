import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient, TablesInsert } from '../database.types';
import type {
  IOpenTaskRepository,
  OpenTaskChanges,
  OpenTaskClaimResult,
  OpenTaskReleaseResult,
} from '#domain/repositories/open-task.repository.interface';
import type { OpenTask } from '#domain/entities/open-task.entity';
import {
  PG_INSUFFICIENT_PRIVILEGE,
  PG_NO_DATA_FOUND,
  PG_OPEN_TASK_CONFLICT,
} from '#domain/constants/postgres-error-codes';
import { SupabaseQueryError } from '../supabase-query-error';
import { fetchAllPages } from '../supabase.utils';

/** Task ids per lookup: 100 uuids keep the URL near 4 KB. */
const TASK_ID_BATCH = 100;

@Injectable()
export class SupabaseOpenTaskRepository implements IOpenTaskRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async findById(chapterId: string, id: string): Promise<OpenTask | null> {
    const { data, error } = await this.supabase
      .from('open_tasks')
      .select('*')
      .eq('chapter_id', chapterId)
      .eq('id', id)
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async findOpen(chapterId: string): Promise<OpenTask[]> {
    return fetchAllPages(
      (from, to) =>
        this.supabase
          .from('open_tasks')
          .select('*')
          .eq('chapter_id', chapterId)
          .eq('status', 'open')
          .order('due_date', { ascending: true })
          .order('created_at', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to),
      { pageSize: 1000 },
    );
  }

  async findClaimedFrom(
    chapterId: string,
    taskIds: string[],
  ): Promise<Map<string, string>> {
    const byTask = new Map<string, string>();
    for (let i = 0; i < taskIds.length; i += TASK_ID_BATCH) {
      const { data, error } = await this.supabase
        .from('open_tasks')
        .select('id, claimed_task_id')
        .eq('chapter_id', chapterId)
        .in('claimed_task_id', taskIds.slice(i, i + TASK_ID_BATCH));
      if (error) throw new SupabaseQueryError(error);
      for (const row of data ?? []) {
        if (row.claimed_task_id) byTask.set(row.claimed_task_id, row.id);
      }
    }
    return byTask;
  }

  async create(data: TablesInsert<'open_tasks'>): Promise<OpenTask> {
    const { data: row, error } = await this.supabase
      .from('open_tasks')
      .insert(data)
      .select('*')
      .single();
    if (error) throw new SupabaseQueryError(error);
    return row;
  }

  async updateOpen(
    chapterId: string,
    id: string,
    changes: OpenTaskChanges,
  ): Promise<OpenTask | null> {
    const { data, error } = await this.supabase
      .from('open_tasks')
      .update({ ...changes, updated_at: new Date().toISOString() })
      .eq('chapter_id', chapterId)
      .eq('id', id)
      .eq('status', 'open')
      .select('*')
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async deleteOpen(chapterId: string, id: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('open_tasks')
      .delete()
      .eq('chapter_id', chapterId)
      .eq('id', id)
      .eq('status', 'open')
      .select('id');
    if (error) throw new SupabaseQueryError(error);
    return (data ?? []).length > 0;
  }

  async claim(
    chapterId: string,
    id: string,
    assigneeId: string,
    createdBy: string,
  ): Promise<OpenTaskClaimResult> {
    const { data, error } = await this.supabase.rpc('claim_open_task', {
      p_chapter_id: chapterId,
      p_open_task_id: id,
      p_assignee_id: assigneeId,
      p_created_by: createdBy,
    });
    if (error) {
      if (error.code === PG_NO_DATA_FOUND)
        return { ok: false, reason: 'missing' };
      if (error.code === PG_OPEN_TASK_CONFLICT) {
        return { ok: false, reason: 'taken' };
      }
      throw new SupabaseQueryError(error);
    }
    const [task] = data ?? [];
    if (!task) throw new Error('claim_open_task returned no task');
    return { ok: true, task };
  }

  async release(
    chapterId: string,
    taskId: string,
    userId: string,
  ): Promise<OpenTaskReleaseResult> {
    const { data, error } = await this.supabase.rpc('release_open_task', {
      p_chapter_id: chapterId,
      p_task_id: taskId,
      p_user_id: userId,
    });
    if (error) {
      if (error.code === PG_NO_DATA_FOUND)
        return { ok: false, reason: 'missing' };
      if (error.code === PG_INSUFFICIENT_PRIVILEGE) {
        return { ok: false, reason: 'not_assignee' };
      }
      if (error.code === PG_OPEN_TASK_CONFLICT) {
        return { ok: false, reason: 'done' };
      }
      throw new SupabaseQueryError(error);
    }
    const [posting] = data ?? [];
    if (!posting) throw new Error('release_open_task returned no posting');
    return { ok: true, posting };
  }
}
