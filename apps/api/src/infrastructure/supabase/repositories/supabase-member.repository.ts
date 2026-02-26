import { Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../supabase.provider';
import { IMemberRepository } from '../../../domain/repositories/member.repository.interface';
import { Member } from '../../../domain/entities/member.entity';

@Injectable()
export class SupabaseMemberRepository implements IMemberRepository {
  constructor(@Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient) {}

  async findById(id: string): Promise<Member | null> {
    const { data } = await this.supabase.from('members').select('*').eq('id', id).single();
    return data;
  }

  async findByUserAndChapter(userId: string, chapterId: string): Promise<Member | null> {
    const { data } = await this.supabase.from('members').select('*').eq('user_id', userId).eq('chapter_id', chapterId).single();
    return data;
  }

  async findByChapter(chapterId: string): Promise<Member[]> {
    const { data } = await this.supabase.from('members').select('*').eq('chapter_id', chapterId);
    return data || [];
  }

  async create(memberData: Partial<Member>): Promise<Member> {
    const { data, error } = await this.supabase.from('members').insert(memberData).select().single();
    if (error) throw error;
    return data;
  }

  async update(id: string, memberData: Partial<Member>): Promise<Member> {
    const { data, error } = await this.supabase.from('members').update(memberData).eq('id', id).select().single();
    if (error) throw error;
    return data;
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.supabase.from('members').delete().eq('id', id);
    if (error) throw error;
  }
}
