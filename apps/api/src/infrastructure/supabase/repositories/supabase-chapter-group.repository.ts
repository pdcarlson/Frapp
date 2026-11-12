import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient } from '../database.types';
import type {
  ChapterGroupChanges,
  IChapterGroupRepository,
} from '#domain/repositories/chapter-group.repository.interface';
import type {
  ChapterGroup,
  ChapterGroupMembership,
} from '#domain/entities/chapter-group.entity';
import { SupabaseQueryError } from '../supabase-query-error';
import {
  PG_FOREIGN_KEY_VIOLATION,
  PG_NO_DATA_FOUND,
  PG_UNIQUE_VIOLATION,
} from '#domain/constants/postgres-error-codes';

/** `chapter_groups` and who is in each (#4076). */
@Injectable()
export class SupabaseChapterGroupRepository implements IChapterGroupRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async findByChapter(chapterId: string): Promise<ChapterGroup[]> {
    const { data, error } = await this.supabase
      .from('chapter_groups')
      .select('*')
      .eq('chapter_id', chapterId)
      .order('created_at', { ascending: true });
    if (error) throw new SupabaseQueryError(error);
    return data ?? [];
  }

  async findById(id: string, chapterId: string): Promise<ChapterGroup | null> {
    const { data, error } = await this.supabase
      .from('chapter_groups')
      .select('*')
      .eq('id', id)
      .eq('chapter_id', chapterId)
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async create(data: {
    chapter_id: string;
    name: string;
    color: string | null;
    mentionable: boolean;
  }): Promise<ChapterGroup | null> {
    const { data: created, error } = await this.supabase
      .from('chapter_groups')
      .insert({ ...data, kind: 'manual' })
      .select()
      .single();
    if (error) {
      if (error.code === PG_UNIQUE_VIOLATION) return null;
      throw new SupabaseQueryError(error);
    }
    return created;
  }

  async update(
    id: string,
    chapterId: string,
    changes: ChapterGroupChanges,
  ): Promise<ChapterGroup | null | undefined> {
    const { data, error } = await this.supabase
      .from('chapter_groups')
      .update(changes)
      .eq('id', id)
      .eq('chapter_id', chapterId)
      .select()
      .maybeSingle();
    if (error) {
      if (error.code === PG_UNIQUE_VIOLATION) return null;
      throw new SupabaseQueryError(error);
    }
    return data ?? undefined;
  }

  async delete(id: string, chapterId: string): Promise<void> {
    const { error } = await this.supabase
      .from('chapter_groups')
      .delete()
      .eq('id', id)
      .eq('chapter_id', chapterId);
    if (error) throw new SupabaseQueryError(error);
  }

  async findMemberships(chapterId: string): Promise<ChapterGroupMembership[]> {
    const { data, error } = await this.supabase
      .from('chapter_group_memberships')
      .select('chapter_id, group_id, user_id')
      .eq('chapter_id', chapterId);
    if (error) throw new SupabaseQueryError(error);
    return data ?? [];
  }

  async findGroupIdsForUser(
    chapterId: string,
    userId: string,
  ): Promise<string[]> {
    const { data, error } = await this.supabase
      .from('chapter_group_memberships')
      .select('group_id')
      .eq('chapter_id', chapterId)
      .eq('user_id', userId);
    if (error) throw new SupabaseQueryError(error);
    return (data ?? []).map((row) => row.group_id);
  }

  async setMembers(
    groupId: string,
    chapterId: string,
    userIds: string[],
  ): Promise<string[] | 'group_not_found' | 'member_not_found'> {
    const { data, error } = await this.supabase.rpc(
      'set_chapter_group_members',
      { p_chapter_id: chapterId, p_group_id: groupId, p_user_ids: userIds },
    );
    if (error) {
      // Both are the function refusing the whole write, not a fault: see
      // 20261113040002_chapter_groups.sql.
      if (error.code === PG_NO_DATA_FOUND) return 'group_not_found';
      if (error.code === PG_FOREIGN_KEY_VIOLATION) return 'member_not_found';
      throw new SupabaseQueryError(error);
    }
    return data ?? [];
  }
}
