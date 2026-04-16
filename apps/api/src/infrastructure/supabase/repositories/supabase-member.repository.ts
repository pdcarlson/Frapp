import { Inject, Injectable } from '@nestjs/common';
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
}
