import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient, TablesInsert } from '../database.types';
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
}
