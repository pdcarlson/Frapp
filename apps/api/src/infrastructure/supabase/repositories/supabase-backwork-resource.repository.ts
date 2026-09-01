import { Inject, Injectable } from '@nestjs/common';
import { escapeFilterValue } from '../supabase.utils';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient, TablesInsert } from '../database.types';
import type {
  IBackworkResourceRepository,
  BackworkResourceFilter,
} from '../../../domain/repositories/backwork.repository.interface';
import { BackworkResource } from '../../../domain/entities/backwork.entity';
import type {
  AssignmentType,
  DocumentVariant,
  Semester,
} from '../../../domain/entities/backwork.entity';

@Injectable()
export class SupabaseBackworkResourceRepository implements IBackworkResourceRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
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
    return data;
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
    // `semester`, `assignment_type` and `document_variant` are enum columns,
    // but `BackworkResourceFilter` types them as plain strings because they
    // arrive as unvalidated `@Query` params on `GET /v1/backwork/resources`.
    // Narrowing them here keeps behavior identical — an out-of-range value
    // still just matches no rows, as it does today. Validating them at the
    // controller (so a bad value 400s instead of returning an empty list) is a
    // behavior change, tracked separately in #787.
    if (filters?.semester) {
      query = query.eq('semester', filters.semester as Semester);
    }
    if (filters?.assignment_type) {
      query = query.eq(
        'assignment_type',
        filters.assignment_type as AssignmentType,
      );
    }
    if (filters?.document_variant) {
      query = query.eq(
        'document_variant',
        filters.document_variant as DocumentVariant,
      );
    }
    if (filters?.search) {
      const safePattern = escapeFilterValue(`%${filters.search}%`);
      query = query.or(
        `title.ilike.${safePattern},course_number.ilike.${safePattern}`,
      );
    }

    const { data, error } = await query.order('created_at', {
      ascending: false,
    });
    if (error) throw error;
    return data || [];
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
    return data;
  }

  async create(
    data: TablesInsert<'backwork_resources'>,
  ): Promise<BackworkResource> {
    const { data: created, error } = await this.supabase
      .from('backwork_resources')
      .insert(data)
      .select()
      .single();
    if (error) throw error;
    return created;
  }

  async delete(id: string, chapterId: string): Promise<void> {
    const { error } = await this.supabase
      .from('backwork_resources')
      .delete()
      .eq('id', id)
      .eq('chapter_id', chapterId);
    if (error) throw error;
  }

  async countByDepartment(
    chapterId: string,
    departmentId: string,
  ): Promise<number> {
    const { count, error } = await this.supabase
      .from('backwork_resources')
      .select('id', { count: 'exact', head: true })
      .eq('chapter_id', chapterId)
      .eq('department_id', departmentId);
    if (error) throw error;
    return count ?? 0;
  }

  async countByProfessor(
    chapterId: string,
    professorId: string,
  ): Promise<number> {
    const { count, error } = await this.supabase
      .from('backwork_resources')
      .select('id', { count: 'exact', head: true })
      .eq('chapter_id', chapterId)
      .eq('professor_id', professorId);
    if (error) throw error;
    return count ?? 0;
  }

  async reassignDepartment(
    chapterId: string,
    fromId: string,
    toId: string,
  ): Promise<number> {
    const { data, error } = await this.supabase
      .from('backwork_resources')
      .update({ department_id: toId })
      .eq('chapter_id', chapterId)
      .eq('department_id', fromId)
      .select('id');
    if (error) throw error;
    return data?.length ?? 0;
  }

  async reassignProfessor(
    chapterId: string,
    fromId: string,
    toId: string,
  ): Promise<number> {
    const { data, error } = await this.supabase
      .from('backwork_resources')
      .update({ professor_id: toId })
      .eq('chapter_id', chapterId)
      .eq('professor_id', fromId)
      .select('id');
    if (error) throw error;
    return data?.length ?? 0;
  }
}
