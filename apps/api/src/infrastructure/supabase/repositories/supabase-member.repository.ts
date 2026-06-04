import { Inject, Injectable } from '@nestjs/common';
import type { PostgrestResponse, SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient } from '../database.types';
import { IMemberRepository } from '../../../domain/repositories/member.repository.interface';
import { Member } from '../../../domain/entities/member.entity';

@Injectable()
export class SupabaseMemberRepository implements IMemberRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async findById(id: string): Promise<Member | null> {
    const { data, error } = await this.supabase
      .from('members')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async findByUserAndChapter(
    userId: string,
    chapterId: string,
  ): Promise<Member | null> {
    const { data, error } = await this.supabase
      .from('members')
      .select('*')
      .eq('user_id', userId)
      .eq('chapter_id', chapterId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async findByUser(userId: string): Promise<Member[]> {
    const { data, error } = await this.supabase
      .from('members')
      .select('*')
      .eq('user_id', userId);
    if (error) throw error;
    return data || [];
  }

  async findByChapter(chapterId: string): Promise<Member[]> {
    const { data, error } = await this.supabase
      .from('members')
      .select('*')
      .eq('chapter_id', chapterId);
    if (error) throw error;
    return data || [];
  }

  async create(memberData: Partial<Member>): Promise<Member> {
    const { data, error } = await this.supabase
      .from('members')
      .insert(memberData as never)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async update(id: string, memberData: Partial<Member>): Promise<Member> {
    const { data, error } = await this.supabase
      .from('members')
      .update(memberData as never)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.supabase.from('members').delete().eq('id', id);
    if (error) throw error;
  }

  async transferPresidencyAtomic(
    chapterId: string,
    currentMemberId: string,
    targetMemberId: string,
    presidentRoleId: string,
  ): Promise<boolean> {
    // `rpc` args/return are not inferred for `FrappSupabaseClient` because
    // generated table Row types do not satisfy PostgREST's schema constraint.
    const { data, error } = (await (this.supabase as SupabaseClient).rpc(
      'transfer_presidency',
      {
        p_chapter_id: chapterId,
        p_current_member_id: currentMemberId,
        p_target_member_id: targetMemberId,
        p_president_role_id: presidentRoleId,
      },
    )) as PostgrestResponse<Member>;
    if (error) throw error;
    // The RPC returns both updated member rows on success, or zero rows when the
    // current member no longer holds the President role in the chapter (race lost
    // / not eligible). The target-missing case raises in SQL and surfaces via
    // `error` above, not as a short row set.
    return (data ?? []).length === 2;
  }
}
