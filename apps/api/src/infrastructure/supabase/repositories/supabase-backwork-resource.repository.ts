import { Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type {
  IBackworkResourceRepository,
  BackworkResourceFilter,
} from '../../../domain/repositories/backwork.repository.interface';
import { BackworkResource } from '../../../domain/entities/backwork.entity';

@Injectable()
export class SupabaseBackworkResourceRepository implements IBackworkResourceRepository {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  async findById(
    id: string,
    chapterId: string,
  ): Promise<BackworkResource | null> {
    const { data, error } = await this.supabase
      .from('backwork_resources')
      .select('*')
      .eq('id', id)
      .eq('chapter_id', chapterId)
      .maybeSingle();
    if (error) throw error;
    return data as BackworkResource | null;
  }

  async findByChapter(
    chapterId: string,
    filters?: BackworkResourceFilter,
  ): Promise<BackworkResource[]> {
    let query = this.supabase
      .from('backwork_resources')
      .select('*')
      .eq('chapter_id', chapterId);

    if (filters?.department_id) {
      query = query.eq('department_id', filters.department_id);
    }
    if (filters?.professor_id) {
      query = query.eq('professor_id', filters.professor_id);
    }
    if (filters?.course_number) {
      query = query.eq('course_number', filters.course_number);
    }
    if (filters?.year) {
      query = query.eq('year', filters.year);
    }
    if (filters?.semester) {
      query = query.eq('semester', filters.semester);
    }
    if (filters?.assignment_type) {
      query = query.eq('assignment_type', filters.assignment_type);
    }
    if (filters?.document_variant) {
      query = query.eq('document_variant', filters.document_variant);
    }
    if (filters?.search) {
      query = query.or(
        `title.ilike.%${filters.search}%,course_number.ilike.%${filters.search}%`,
      );
    }

    const { data, error } = await query.order('created_at', {
      ascending: false,
    });
    if (error) throw error;
    return (data as BackworkResource[]) || [];
  }

  async findByFileHash(
    chapterId: string,
    fileHash: string,
  ): Promise<BackworkResource | null> {
    const { data, error } = await this.supabase
      .from('backwork_resources')
      .select('*')
      .eq('chapter_id', chapterId)
      .eq('file_hash', fileHash)
      .maybeSingle();
    if (error) throw error;
    return data as BackworkResource | null;
  }

  async create(data: Partial<BackworkResource>): Promise<BackworkResource> {
    const { data: created, error } = await this.supabase
      .from('backwork_resources')
      .insert(data)
      .select()
      .single();
    if (error) throw error;
    return created as BackworkResource;
  }

  async delete(id: string, chapterId: string): Promise<void> {
    const { error } = await this.supabase
      .from('backwork_resources')
      .delete()
      .eq('id', id)
      .eq('chapter_id', chapterId);
    if (error) throw error;
  }
}
