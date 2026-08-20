import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient, TablesInsert, TablesUpdate } from '../database.types';
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

  async create(memberData: TablesInsert<'members'>): Promise<Member> {
    const { data, error } = await this.supabase
      .from('members')
      .insert(memberData)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async update(id: string, memberData: TablesUpdate<'members'>): Promise<Member> {
    const { data, error } = await this.supabase
      .from('members')
      .update(memberData)
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
    const { data, error } = await this.supabase.rpc('transfer_presidency', {
      p_chapter_id: chapterId,
      p_current_member_id: currentMemberId,
      p_target_member_id: targetMemberId,
      p_president_role_id: presidentRoleId,
    });
    if (error) throw error;
    // The RPC returns both updated member rows on success, or zero rows when the
    // current member no longer holds the President role in the chapter (race lost
    // / not eligible). The target-missing case raises in SQL and surfaces via
    // `error` above, not as a short row set.
    return (data ?? []).length === 2;
  }
}
