import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type {
  FrappSupabaseClient,
  TablesInsert,
  TablesUpdate,
} from '../database.types';
import { PG_UNIQUE_VIOLATION } from '#domain/constants/postgres-error-codes';
import {
  CustomRoleKeyConflictError,
  type ICustomRoleRepository,
} from '#domain/repositories/custom-role.repository.interface';
import type { ChapterCustomRole } from '#domain/entities/chapter-custom-role.entity';
import { SupabaseQueryError } from '../supabase-query-error';

@Injectable()
export class SupabaseCustomRoleRepository implements ICustomRoleRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async findByChapter(chapterId: string): Promise<ChapterCustomRole[]> {
    const { data, error } = await this.supabase
      .from('chapter_custom_roles')
      .select('*')
      .eq('chapter_id', chapterId)
      .order('rank', { ascending: true });
    if (error) throw new SupabaseQueryError(error);
    return data ?? [];
  }

  async findByIds(
    ids: string[],
    chapterId: string,
  ): Promise<ChapterCustomRole[]> {
    if (!ids.length) return [];
    const { data, error } = await this.supabase
      .from('chapter_custom_roles')
      .select('*')
      .in('id', ids)
      .eq('chapter_id', chapterId);
    if (error) throw new SupabaseQueryError(error);
    return data ?? [];
  }

  async findById(
    id: string,
    chapterId: string,
  ): Promise<ChapterCustomRole | null> {
    const { data, error } = await this.supabase
      .from('chapter_custom_roles')
      .select('*')
      .eq('id', id)
      .eq('chapter_id', chapterId)
      .maybeSingle();
    // A failed read is reported as a miss and not logged (#2459); see the
    // interface. Kept as-is so this move changed no behavior.
    if (error) return null;
    return data;
  }

  async create(
    data: TablesInsert<'chapter_custom_roles'>,
  ): Promise<ChapterCustomRole> {
    const { data: created, error } = await this.supabase
      .from('chapter_custom_roles')
      .insert(data)
      .select()
      .single();
    if (error) {
      if (error.code === PG_UNIQUE_VIOLATION) {
        throw new CustomRoleKeyConflictError();
      }
      throw new SupabaseQueryError(error);
    }
    return created;
  }

  async update(
    id: string,
    chapterId: string,
    patch: TablesUpdate<'chapter_custom_roles'>,
  ): Promise<ChapterCustomRole | null> {
    const { data, error } = await this.supabase
      .from('chapter_custom_roles')
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
      .from('chapter_custom_roles')
      .delete()
      .eq('id', id)
      .eq('chapter_id', chapterId);
    if (error) throw new SupabaseQueryError(error);
  }
}
