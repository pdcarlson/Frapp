import { Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { ISemesterArchiveRepository } from '../../../domain/repositories/semester-archive.repository.interface';
import type { SemesterArchive } from '../../../domain/entities/semester-archive.entity';

@Injectable()
export class SupabaseSemesterArchiveRepository
  implements ISemesterArchiveRepository
{
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  async findByChapter(chapterId: string): Promise<SemesterArchive[]> {
    const { data, error } = await this.supabase
      .from('semester_archives')
      .select('*')
      .eq('chapter_id', chapterId)
      .order('end_date', { ascending: false });
    if (error) throw error;
    return (data as SemesterArchive[]) || [];
  }

  async findLatestByChapter(
    chapterId: string,
  ): Promise<SemesterArchive | null> {
    const { data, error } = await this.supabase
      .from('semester_archives')
      .select('*')
      .eq('chapter_id', chapterId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data as SemesterArchive | null;
  }

  async create(data: Partial<SemesterArchive>): Promise<SemesterArchive> {
    const { data: created, error } = await this.supabase
      .from('semester_archives')
      .insert(data)
      .select()
      .single();
    if (error) throw error;
    return created as SemesterArchive;
  }
}
