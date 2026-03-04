import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient } from '../database.types';
import type { IBackworkDepartmentRepository } from '../../../domain/repositories/backwork.repository.interface';
import { BackworkDepartment } from '../../../domain/entities/backwork.entity';

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
    return (data as BackworkDepartment[]) || [];
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
    return data as BackworkDepartment | null;
  }

  async create(data: Partial<BackworkDepartment>): Promise<BackworkDepartment> {
    const { data: created, error } = await this.supabase
      .from('backwork_departments')
      .insert(data as never)
      .select()
      .single();
    if (error) throw error;
    return created as BackworkDepartment;
  }

  async update(
    id: string,
    data: Partial<BackworkDepartment>,
  ): Promise<BackworkDepartment> {
    const { data: updated, error } = await this.supabase
      .from('backwork_departments')
      .update(data as never)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return updated as BackworkDepartment;
  }
}
