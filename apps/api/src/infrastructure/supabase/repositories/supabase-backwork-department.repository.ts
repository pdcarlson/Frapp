import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type {
  FrappSupabaseClient,
  TablesInsert,
  TablesUpdate,
} from '../database.types';
import type { IBackworkDepartmentRepository } from '#domain/repositories/backwork.repository.interface';
import { BackworkDepartment } from '#domain/entities/backwork.entity';

@Injectable()
export class SupabaseBackworkDepartmentRepository implements IBackworkDepartmentRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async findByChapter(chapterId: string): Promise<BackworkDepartment[]> {
    const { data, error } = await this.supabase
      .from('backwork_departments')
      .select('*')
      .eq('chapter_id', chapterId)
      .order('code', { ascending: true });
    if (error) throw error;
    return data || [];
  }

  async findByCode(
    chapterId: string,
    code: string,
  ): Promise<BackworkDepartment | null> {
    const { data, error } = await this.supabase
      .from('backwork_departments')
      .select('*')
      .eq('chapter_id', chapterId)
      .eq('code', code)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async create(
    data: TablesInsert<'backwork_departments'>,
  ): Promise<BackworkDepartment> {
    const { data: created, error } = await this.supabase
      .from('backwork_departments')
      .insert(data)
      .select()
      .single();
    if (error) throw error;
    return created;
  }

  async findById(
    id: string,
    chapterId: string,
  ): Promise<BackworkDepartment | null> {
    const { data, error } = await this.supabase
      .from('backwork_departments')
      .select('*')
      .eq('id', id)
      .eq('chapter_id', chapterId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async update(
    id: string,
    chapterId: string,
    data: TablesUpdate<'backwork_departments'>,
  ): Promise<BackworkDepartment | null> {
    // `chapter_id` is part of the filter, not just a post-hoc check: the update
    // itself must be unable to touch another chapter's row. `maybeSingle`
    // (rather than `single`) turns "no row matched" into `null` so the caller
    // can raise a 404 instead of a PostgREST error.
    const { data: updated, error } = await this.supabase
      .from('backwork_departments')
      .update(data)
      .eq('id', id)
      .eq('chapter_id', chapterId)
      .select()
      .maybeSingle();
    if (error) throw error;
    return updated;
  }

  async delete(id: string, chapterId: string): Promise<void> {
    const { error } = await this.supabase
      .from('backwork_departments')
      .delete()
      .eq('id', id)
      .eq('chapter_id', chapterId);
    if (error) throw error;
  }
}
