import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type {
  FrappSupabaseClient,
  TablesInsert,
  TablesUpdate,
} from '../database.types';
import { PG_UNIQUE_VIOLATION } from '#domain/constants/postgres-error-codes';
import {
  CustomFieldKeyConflictError,
  type ICustomFieldRepository,
} from '#domain/repositories/custom-field.repository.interface';
import type {
  ChapterCustomField,
  CustomFieldVisibility,
} from '#domain/entities/chapter-custom-field.entity';
import { SupabaseQueryError } from '../supabase-query-error';

@Injectable()
export class SupabaseCustomFieldRepository implements ICustomFieldRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async findByChapter(chapterId: string): Promise<ChapterCustomField[]> {
    const { data, error } = await this.supabase
      .from('chapter_custom_fields')
      .select('*')
      .eq('chapter_id', chapterId)
      .order('sort', { ascending: true })
      .order('created_at', { ascending: true });
    if (error) throw new SupabaseQueryError(error);
    return data ?? [];
  }

  async findByVisibility(
    chapterId: string,
    visibilities: CustomFieldVisibility[],
  ): Promise<ChapterCustomField[]> {
    const { data, error } = await this.supabase
      .from('chapter_custom_fields')
      .select('*')
      .eq('chapter_id', chapterId)
      .in('visibility', visibilities)
      .order('sort', { ascending: true })
      .order('created_at', { ascending: true });
    if (error) throw new SupabaseQueryError(error);
    return data ?? [];
  }

  async findIdsByVisibility(
    chapterId: string,
    visibilities: CustomFieldVisibility[],
  ): Promise<{ id: string; visibility: CustomFieldVisibility }[]> {
    const { data, error } = await this.supabase
      .from('chapter_custom_fields')
      .select('id, visibility')
      .eq('chapter_id', chapterId)
      .in('visibility', visibilities);
    if (error) throw new SupabaseQueryError(error);
    return data ?? [];
  }

  async findById(
    id: string,
    chapterId: string,
  ): Promise<ChapterCustomField | null> {
    const { data, error } = await this.supabase
      .from('chapter_custom_fields')
      .select('*')
      .eq('id', id)
      .eq('chapter_id', chapterId)
      .maybeSingle();
    // A failed read is reported as a miss and not logged (#2459); see the
    // interface. Kept as-is so this move changed no behavior.
    if (error) return null;
    return data;
  }

  async findMaxSort(chapterId: string): Promise<number | null> {
    const { data, error } = await this.supabase
      .from('chapter_custom_fields')
      .select('sort')
      .eq('chapter_id', chapterId)
      .order('sort', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data ? data.sort : null;
  }

  async create(
    data: TablesInsert<'chapter_custom_fields'>,
  ): Promise<ChapterCustomField> {
    const { data: created, error } = await this.supabase
      .from('chapter_custom_fields')
      .insert(data)
      .select()
      .single();
    if (error) {
      if (error.code === PG_UNIQUE_VIOLATION) {
        throw new CustomFieldKeyConflictError();
      }
      throw new SupabaseQueryError(error);
    }
    return created;
  }

  async seedDefaults(
    rows: TablesInsert<'chapter_custom_fields'>[],
  ): Promise<void> {
    // `ignoreDuplicates` turns a unique violation on `(chapter_id, key)` into
    // a skipped row, which is what makes re-running provisioning a no-op.
    const { error } = await this.supabase
      .from('chapter_custom_fields')
      .upsert(rows, { onConflict: 'chapter_id,key', ignoreDuplicates: true });
    if (error) throw new SupabaseQueryError(error);
  }

  async update(
    id: string,
    chapterId: string,
    patch: TablesUpdate<'chapter_custom_fields'>,
  ): Promise<ChapterCustomField | null> {
    const { data, error } = await this.supabase
      .from('chapter_custom_fields')
      .update(patch)
      .eq('id', id)
      .eq('chapter_id', chapterId)
      .select()
      .single();
    // `.single()` reports no matching row as an error too, so this one branch
    // covers both the miss and a failed write (#2459); see the interface.
    if (error) return null;
    return data;
  }

  async delete(id: string, chapterId: string): Promise<void> {
    const { error } = await this.supabase
      .from('chapter_custom_fields')
      .delete()
      .eq('id', id)
      .eq('chapter_id', chapterId);
    if (error) throw new SupabaseQueryError(error);
  }

  async findValuesForMember(
    memberId: string,
    fieldIds: string[],
  ): Promise<{ field_id: string; value: string | null }[]> {
    const { data, error } = await this.supabase
      .from('member_custom_field_values')
      .select('field_id, value')
      .eq('member_id', memberId)
      .in('field_id', fieldIds);
    if (error) throw new SupabaseQueryError(error);
    return data ?? [];
  }

  async findValuesByFieldIds(
    fieldIds: string[],
  ): Promise<{ member_id: string; field_id: string; value: string | null }[]> {
    if (!fieldIds.length) return [];
    const { data, error } = await this.supabase
      .from('member_custom_field_values')
      .select('member_id, field_id, value')
      .in('field_id', fieldIds);
    if (error) throw new SupabaseQueryError(error);
    return data ?? [];
  }
}
