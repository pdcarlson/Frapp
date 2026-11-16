import { Inject, Injectable } from '@nestjs/common';
import { escapeFilterValue } from '../supabase.utils';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient, TablesInsert } from '../database.types';
import type {
  IBackworkResourceRepository,
  BackworkPublishedColumns,
  BackworkResourceFilter,
} from '#domain/repositories/backwork.repository.interface';
import { BackworkResource } from '#domain/entities/backwork.entity';
import type {
  BackworkDraftFields,
  AssignmentType,
  DocumentVariant,
  Semester,
} from '#domain/entities/backwork.entity';
import { SupabaseQueryError } from '../supabase-query-error';

@Injectable()
export class SupabaseBackworkResourceRepository implements IBackworkResourceRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async findById(
    id: string,
    chapterId: string,
    options?: { includeDrafts?: boolean },
  ): Promise<BackworkResource | null> {
    let query = this.supabase
      .from('backwork_resources')
      .select('*')
      .eq('id', id)
      .eq('chapter_id', chapterId);
    if (!options?.includeDrafts) query = query.is('draft_fields', null);
    const { data, error } = await query.maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async findByChapter(
    chapterId: string,
    filters?: BackworkResourceFilter,
  ): Promise<BackworkResource[]> {
    let query = this.supabase
      .from('backwork_resources')
      .select('*')
      .eq('chapter_id', chapterId)
      .is('draft_fields', null);

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
    if (error) throw new SupabaseQueryError(error);
    return data || [];
  }

  async findByIds(
    ids: string[],
    chapterId: string,
  ): Promise<BackworkResource[]> {
    if (ids.length === 0) return [];
    const { data, error } = await this.supabase
      .from('backwork_resources')
      .select('*')
      .eq('chapter_id', chapterId)
      .is('draft_fields', null)
      .in('id', ids);
    if (error) throw new SupabaseQueryError(error);
    return data ?? [];
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
    if (error) throw new SupabaseQueryError(error);
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
    if (error) throw new SupabaseQueryError(error);
    return created;
  }

  async delete(id: string, chapterId: string): Promise<void> {
    const { error } = await this.supabase
      .from('backwork_resources')
      .delete()
      .eq('id', id)
      .eq('chapter_id', chapterId);
    if (error) throw new SupabaseQueryError(error);
  }

  async findDrafts(
    chapterId: string,
    uploaderId: string,
  ): Promise<BackworkResource[]> {
    const { data, error } = await this.supabase
      .from('backwork_resources')
      .select('*')
      .eq('chapter_id', chapterId)
      .eq('uploader_id', uploaderId)
      .not('draft_fields', 'is', null)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true });
    if (error) throw new SupabaseQueryError(error);
    return data ?? [];
  }

  async findDraftsByIds(
    ids: string[],
    chapterId: string,
    uploaderId: string,
  ): Promise<BackworkResource[]> {
    if (ids.length === 0) return [];
    const { data, error } = await this.supabase
      .from('backwork_resources')
      .select('*')
      .eq('chapter_id', chapterId)
      .eq('uploader_id', uploaderId)
      .not('draft_fields', 'is', null)
      .in('id', ids);
    if (error) throw new SupabaseQueryError(error);
    return data ?? [];
  }

  async updateDraftFields(
    id: string,
    chapterId: string,
    uploaderId: string,
    fields: BackworkDraftFields,
  ): Promise<BackworkResource | null> {
    const { data, error } = await this.supabase
      .from('backwork_resources')
      .update({ draft_fields: fields })
      .eq('id', id)
      .eq('chapter_id', chapterId)
      .eq('uploader_id', uploaderId)
      .not('draft_fields', 'is', null)
      .select()
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async replaceDraftFile(
    id: string,
    chapterId: string,
    uploaderId: string,
    update: {
      storage_path: string;
      file_hash: string;
      is_redacted: boolean;
      draft_fields: BackworkDraftFields;
    },
  ): Promise<BackworkResource | null> {
    const { data, error } = await this.supabase
      .from('backwork_resources')
      .update(update)
      .eq('id', id)
      .eq('chapter_id', chapterId)
      .eq('uploader_id', uploaderId)
      .not('draft_fields', 'is', null)
      .select()
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async publishDraft(
    id: string,
    chapterId: string,
    uploaderId: string,
    columns: BackworkPublishedColumns,
  ): Promise<BackworkResource | null> {
    const { data, error } = await this.supabase
      .from('backwork_resources')
      // Published now, so it reads as added now in the library and Activity,
      // which order by created_at.
      .update({
        ...columns,
        draft_fields: null,
        created_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('chapter_id', chapterId)
      .eq('uploader_id', uploaderId)
      .not('draft_fields', 'is', null)
      .select()
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async deleteDraft(
    id: string,
    chapterId: string,
    uploaderId: string,
  ): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('backwork_resources')
      .delete()
      .eq('id', id)
      .eq('chapter_id', chapterId)
      .eq('uploader_id', uploaderId)
      .not('draft_fields', 'is', null)
      .select('id');
    if (error) throw new SupabaseQueryError(error);
    return (data ?? []).length > 0;
  }

  async countByDepartment(
    chapterId: string,
    departmentId: string,
  ): Promise<number> {
    return this.countByColumn(chapterId, 'department_id', departmentId);
  }

  async countByProfessor(
    chapterId: string,
    professorId: string,
  ): Promise<number> {
    return this.countByColumn(chapterId, 'professor_id', professorId);
  }

  async reassignDepartment(
    chapterId: string,
    fromId: string,
    toId: string,
  ): Promise<number> {
    return this.reassignColumn(chapterId, 'department_id', fromId, toId);
  }

  async reassignProfessor(
    chapterId: string,
    fromId: string,
    toId: string,
  ): Promise<number> {
    return this.reassignColumn(chapterId, 'professor_id', fromId, toId);
  }

  /** Shared by `countByDepartment`/`countByProfessor` — same table, same shape, differing only by column. */
  private async countByColumn(
    chapterId: string,
    column: 'department_id' | 'professor_id',
    value: string,
  ): Promise<number> {
    const { count, error } = await this.supabase
      .from('backwork_resources')
      .select('id', { count: 'exact', head: true })
      .eq('chapter_id', chapterId)
      .eq(column, value);
    if (error) throw new SupabaseQueryError(error);
    return count ?? 0;
  }

  /** Shared by `reassignDepartment`/`reassignProfessor` — same table, same shape, differing only by column. */
  private async reassignColumn(
    chapterId: string,
    column: 'department_id' | 'professor_id',
    fromId: string,
    toId: string,
  ): Promise<number> {
    // A computed `{ [column]: toId }` key doesn't type-check against the
    // generated (index-signature-free) update type, so the two columns are
    // spelled out rather than cast away.
    const updateData =
      column === 'department_id'
        ? { department_id: toId }
        : { professor_id: toId };
    const { data, error } = await this.supabase
      .from('backwork_resources')
      .update(updateData)
      .eq('chapter_id', chapterId)
      .eq(column, fromId)
      .select('id');
    if (error) throw new SupabaseQueryError(error);
    return data?.length ?? 0;
  }
}
