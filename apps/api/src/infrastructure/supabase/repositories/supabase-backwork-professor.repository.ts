import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type {
  FrappSupabaseClient,
  TablesInsert,
  TablesUpdate,
} from '../database.types';
import type { IBackworkProfessorRepository } from '../../../domain/repositories/backwork.repository.interface';
import { BackworkProfessor } from '../../../domain/entities/backwork.entity';

@Injectable()
export class SupabaseBackworkProfessorRepository implements IBackworkProfessorRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async findByChapter(chapterId: string): Promise<BackworkProfessor[]> {
    const { data, error } = await this.supabase
      .from('backwork_professors')
      .select('*')
      .eq('chapter_id', chapterId)
      .order('name', { ascending: true });
    if (error) throw error;
    return data || [];
  }

  async findByName(
    chapterId: string,
    name: string,
  ): Promise<BackworkProfessor | null> {
    const { data, error } = await this.supabase
      .from('backwork_professors')
      .select('*')
      .eq('chapter_id', chapterId)
      .eq('name', name)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async findById(
    id: string,
    chapterId: string,
  ): Promise<BackworkProfessor | null> {
    const { data, error } = await this.supabase
      .from('backwork_professors')
      .select('*')
      .eq('id', id)
      .eq('chapter_id', chapterId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async create(
    data: TablesInsert<'backwork_professors'>,
  ): Promise<BackworkProfessor> {
    const { data: created, error } = await this.supabase
      .from('backwork_professors')
      .insert(data)
      .select()
      .single();
    if (error) throw error;
    return created;
  }

  async update(
    id: string,
    chapterId: string,
    data: TablesUpdate<'backwork_professors'>,
  ): Promise<BackworkProfessor | null> {
    // Same chapter-scoped-filter shape as the department repository's update.
    const { data: updated, error } = await this.supabase
      .from('backwork_professors')
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
      .from('backwork_professors')
      .delete()
      .eq('id', id)
      .eq('chapter_id', chapterId);
    if (error) throw error;
  }
}
