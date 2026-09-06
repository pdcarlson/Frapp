import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type {
  FrappSupabaseClient,
  TablesInsert,
  TablesUpdate,
} from '../database.types';
import { IInviteRepository } from '#domain/repositories/invite.repository.interface';
import { Invite } from '#domain/entities/invite.entity';

@Injectable()
export class SupabaseInviteRepository implements IInviteRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async findById(id: string): Promise<Invite | null> {
    const { data, error } = await this.supabase
      .from('invites')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async createMany(inviteData: TablesInsert<'invites'>[]): Promise<Invite[]> {
    const { data, error } = await this.supabase
      .from('invites')
      .insert(inviteData)
      .select();
    if (error) throw error;
    return data || [];
  }

  async findByToken(token: string): Promise<Invite | null> {
    const { data, error } = await this.supabase
      .from('invites')
      .select('*')
      .eq('token', token)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async findByChapter(chapterId: string): Promise<Invite[]> {
    const { data, error } = await this.supabase
      .from('invites')
      .select('*')
      .eq('chapter_id', chapterId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  }

  async create(inviteData: TablesInsert<'invites'>): Promise<Invite> {
    const { data, error } = await this.supabase
      .from('invites')
      .insert(inviteData)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async markUsed(id: string): Promise<void> {
    const patch: TablesUpdate<'invites'> = {
      used_at: new Date().toISOString(),
    };
    const { error } = await this.supabase
      .from('invites')
      .update(patch)
      .eq('id', id);
    if (error) throw error;
  }

  async markUsedAtomically(id: string): Promise<boolean> {
    const patch: TablesUpdate<'invites'> = {
      used_at: new Date().toISOString(),
    };
    const { data, error } = await this.supabase
      .from('invites')
      .update(patch)
      .eq('id', id)
      .is('used_at', null)
      .select('id');
    if (error) throw error;
    return Array.isArray(data) && data.length > 0;
  }
}
