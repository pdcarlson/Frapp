import { Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../supabase.provider';
import { ITaskRepository } from '../../../domain/repositories/task.repository.interface';
import { Task } from '../../../domain/entities/task.entity';

@Injectable()
export class SupabaseTaskRepository implements ITaskRepository {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  async findById(id: string, chapterId: string): Promise<Task | null> {
    const { data, error } = await this.supabase
      .from('tasks')
      .select('*')
      .eq('id', id)
      .eq('chapter_id', chapterId)
      .maybeSingle();
    if (error) throw error;
    return data as Task | null;
  }

  async findByChapter(chapterId: string): Promise<Task[]> {
    const { data, error } = await this.supabase
      .from('tasks')
      .select('*')
      .eq('chapter_id', chapterId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data as Task[]) || [];
  }

  async findByAssignee(
    chapterId: string,
    assigneeId: string,
  ): Promise<Task[]> {
    const { data, error } = await this.supabase
      .from('tasks')
      .select('*')
      .eq('chapter_id', chapterId)
      .eq('assignee_id', assigneeId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data as Task[]) || [];
  }

  async create(data: Partial<Task>): Promise<Task> {
    const { data: created, error } = await this.supabase
      .from('tasks')
      .insert(data)
      .select()
      .single();

    if (error) throw error;
    return created as Task;
  }

  async update(
    id: string,
    chapterId: string,
    data: Partial<Task>,
  ): Promise<Task> {
    const { data: updated, error } = await this.supabase
      .from('tasks')
      .update(data)
      .eq('id', id)
      .eq('chapter_id', chapterId)
      .select()
      .single();

    if (error) throw error;
    return updated as Task;
  }

  async delete(id: string, chapterId: string): Promise<void> {
    const { error } = await this.supabase
      .from('tasks')
      .delete()
      .eq('id', id)
      .eq('chapter_id', chapterId);

    if (error) throw error;
  }
}
