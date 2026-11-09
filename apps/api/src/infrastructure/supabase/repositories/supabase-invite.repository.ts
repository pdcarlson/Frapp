import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type {
  FrappSupabaseClient,
  TablesInsert,
  TablesUpdate,
} from '../database.types';
import { IInviteRepository } from '#domain/repositories/invite.repository.interface';
import { Invite } from '#domain/entities/invite.entity';
import { SupabaseQueryError } from '../supabase-query-error';
import { escapeLikePattern } from '../supabase.utils';

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
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async createMany(inviteData: TablesInsert<'invites'>[]): Promise<Invite[]> {
    const { data, error } = await this.supabase
      .from('invites')
      .insert(inviteData)
      .select();
    if (error) throw new SupabaseQueryError(error);
    return data || [];
  }

  async findByToken(token: string): Promise<Invite | null> {
    const { data, error } = await this.supabase
      .from('invites')
      .select('*')
      .eq('token', token)
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async findByChapter(chapterId: string): Promise<Invite[]> {
    const { data, error } = await this.supabase
      .from('invites')
      .select('*')
      .eq('chapter_id', chapterId)
      .order('created_at', { ascending: false });
    if (error) throw new SupabaseQueryError(error);
    return data || [];
  }

  async findPendingByEmail(email: string, now: Date): Promise<Invite[]> {
    // Narrowed in SQL, decided in code. The `ilike` bounds the read to this
    // address (case-insensitively: addresses are stored as typed), but it is
    // not exact on its own: PostgREST reads `*` in a like pattern as `%`, and
    // no escaping turns it back into a literal, so `*@school.edu` would match
    // everyone at that domain. The comparison below is what decides, so a `*`
    // can only widen the read, never the answer.
    const wanted = email.trim().toLowerCase();
    const { data, error } = await this.supabase
      .from('invites')
      .select('*')
      .ilike('email', escapeLikePattern(wanted))
      .is('used_at', null)
      .is('revoked_at', null)
      .gt('expires_at', now.toISOString())
      .order('created_at', { ascending: false });
    if (error) throw new SupabaseQueryError(error);
    return (data || []).filter(
      (invite) => invite.email?.trim().toLowerCase() === wanted,
    );
  }

  async create(inviteData: TablesInsert<'invites'>): Promise<Invite> {
    const { data, error } = await this.supabase
      .from('invites')
      .insert(inviteData)
      .select()
      .single();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async markRevoked(id: string): Promise<void> {
    // `used_at` too, so every path that refuses a used token refuses a revoked
    // one without learning about `revoked_at`, and a redeem's `releaseClaim`
    // (which matches its own `used_at`) can't reopen it.
    const now = new Date().toISOString();
    const patch: TablesUpdate<'invites'> = {
      used_at: now,
      revoked_at: now,
    };
    const { error } = await this.supabase
      .from('invites')
      .update(patch)
      .eq('id', id)
      .is('revoked_at', null);
    if (error) throw new SupabaseQueryError(error);
  }

  async revokePending(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const now = new Date().toISOString();
    const patch: TablesUpdate<'invites'> = {
      used_at: now,
      revoked_at: now,
    };
    const { error } = await this.supabase
      .from('invites')
      .update(patch)
      .in('id', ids)
      .is('used_at', null);
    if (error) throw new SupabaseQueryError(error);
  }

  async markUsedAtomically(id: string): Promise<string | null> {
    const patch: TablesUpdate<'invites'> = {
      used_at: new Date().toISOString(),
    };
    const { data, error } = await this.supabase
      .from('invites')
      .update(patch)
      .eq('id', id)
      .is('used_at', null)
      .select('used_at');
    if (error) throw new SupabaseQueryError(error);
    const usedAt = Array.isArray(data) && data[0] ? data[0].used_at : null;
    return typeof usedAt === 'string' ? usedAt : null;
  }

  async releaseClaim(id: string, claimedAt: string): Promise<boolean> {
    const patch: TablesUpdate<'invites'> = {
      used_at: null,
    };
    const { data, error } = await this.supabase
      .from('invites')
      .update(patch)
      .eq('id', id)
      .eq('used_at', claimedAt)
      // A revoke in the same millisecond would leave used_at equal.
      .is('revoked_at', null)
      .select('id');
    if (error) throw new SupabaseQueryError(error);
    return Array.isArray(data) && data.length > 0;
  }
}
