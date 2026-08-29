import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient, TablesInsert } from '../database.types';
import type { ISemesterArchiveRepository } from '../../../domain/repositories/semester-archive.repository.interface';
import type { SemesterArchive } from '../../../domain/entities/semester-archive.entity';

@Injectable()
export class SupabaseSemesterArchiveRepository implements ISemesterArchiveRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async findByChapter(chapterId: string): Promise<SemesterArchive[]> {
    const { data, error } = await this.supabase
      .from('semester_archives')
      .select('*')
      .eq('chapter_id', chapterId)
      .order('end_date', { ascending: false });
    if (error) throw error;
    return data || [];
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
    return data;
  }

  async create(
    data: TablesInsert<'semester_archives'>,
  ): Promise<SemesterArchive> {
    const { data: created, error } = await this.supabase
      .from('semester_archives')
      .insert(data)
      .select()
      .single();
    if (error) throw error;
    return created;
  }

  async createWithPromotion(params: {
    chapterId: string;
    label: string;
    startDate: string;
    endDate: string;
    newMemberRoleId: string;
    memberRoleId: string;
  }): Promise<SemesterArchive> {
    // One RPC, one implicit transaction: the archive insert and the chapter-wide
    // role swap either both commit or neither does. Two separate writes could
    // archive the semester and then fail to promote, and the once-per-calendar-
    // month guard would block the retry that would fix it.
    const { data, error } = await this.supabase.rpc('rollover_semester', {
      p_chapter_id: params.chapterId,
      p_label: params.label,
      p_start_date: params.startDate,
      p_end_date: params.endDate,
      p_new_member_role_id: params.newMemberRoleId,
      p_member_role_id: params.memberRoleId,
    });
    if (error) throw error;
    return data;
  }
}
