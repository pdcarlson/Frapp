import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient, TablesInsert } from '../database.types';
import { IPledgeClassRepository } from '#domain/repositories/pledge-class.repository.interface';
import {
  PledgeClass,
  PledgeClassAssignment,
} from '#domain/entities/pledge-class.entity';
import { Member } from '#domain/entities/member.entity';
import { SupabaseQueryError } from '../supabase-query-error';

/** Postgres `unique_violation`: the chapter already has a class of that name. */
const UNIQUE_VIOLATION = '23505';

@Injectable()
export class SupabasePledgeClassRepository implements IPledgeClassRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async findByChapter(chapterId: string): Promise<PledgeClass[]> {
    const { data, error } = await this.supabase
      .from('chapter_pledge_classes')
      .select('*')
      .eq('chapter_id', chapterId)
      .order('position', { ascending: true })
      .order('created_at', { ascending: true });
    if (error) throw new SupabaseQueryError(error);
    return data ?? [];
  }

  async findById(id: string, chapterId: string): Promise<PledgeClass | null> {
    const { data, error } = await this.supabase
      .from('chapter_pledge_classes')
      .select('*')
      .eq('id', id)
      .eq('chapter_id', chapterId)
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async create(
    data: TablesInsert<'chapter_pledge_classes'>,
  ): Promise<PledgeClass | null> {
    const { data: created, error } = await this.supabase
      .from('chapter_pledge_classes')
      .insert(data)
      .select()
      .single();
    if (error) {
      if (error.code === UNIQUE_VIOLATION) return null;
      throw new SupabaseQueryError(error);
    }
    return created;
  }

  async rename(
    id: string,
    chapterId: string,
    name: string,
  ): Promise<PledgeClass | null | undefined> {
    const { data, error } = await this.supabase
      .from('chapter_pledge_classes')
      .update({ name })
      .eq('id', id)
      .eq('chapter_id', chapterId)
      .select()
      .maybeSingle();
    if (error) {
      if (error.code === UNIQUE_VIOLATION) return null;
      throw new SupabaseQueryError(error);
    }
    return data ?? undefined;
  }

  async reorder(chapterId: string, ids: string[]): Promise<PledgeClass[]> {
    const { data, error } = await this.supabase.rpc(
      'reorder_chapter_pledge_classes',
      { p_chapter_id: chapterId, p_ids: ids },
    );
    if (error) throw new SupabaseQueryError(error);
    return data ?? [];
  }

  async delete(id: string, chapterId: string): Promise<void> {
    const { error } = await this.supabase
      .from('chapter_pledge_classes')
      .delete()
      .eq('id', id)
      .eq('chapter_id', chapterId);
    if (error) throw new SupabaseQueryError(error);
  }

  async assignMembers(
    chapterId: string,
    assignments: PledgeClassAssignment[],
  ): Promise<Member[]> {
    const { data, error } = await this.supabase.rpc(
      'assign_member_pledge_classes',
      { p_chapter_id: chapterId, p_assignments: assignments },
    );
    if (error) throw new SupabaseQueryError(error);
    return data ?? [];
  }
}
