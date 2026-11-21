import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type {
  FrappSupabaseClient,
  TablesInsert,
  TablesUpdate,
} from '../database.types';
import { IUserRepository } from '#domain/repositories/user.repository.interface';
import {
  User,
  UserContact,
  UserDisplayIdentity,
  UserSharedBirthday,
} from '#domain/entities/user.entity';
import { chunkIds } from '#domain/utils/chunk-ids';
import { SupabaseQueryError } from '../supabase-query-error';

@Injectable()
export class SupabaseUserRepository implements IUserRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async findById(id: string): Promise<User | null> {
    const { data, error } = await this.supabase
      .from('users')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async findByIds(ids: string[]): Promise<User[]> {
    if (!ids.length) return [];
    const { data, error } = await this.supabase
      .from('users')
      .select('*')
      .in('id', ids);
    if (error) throw new SupabaseQueryError(error);
    return data ?? [];
  }

  async findDisplayIdentitiesByIds(
    ids: string[],
  ): Promise<UserDisplayIdentity[]> {
    return this.findColumnsByIds(ids, 'id, display_name, avatar_url');
  }

  async findContactsByIds(ids: string[]): Promise<UserContact[]> {
    return this.findColumnsByIds(ids, 'id, display_name, email');
  }

  async findSharedBirthdaysByIds(ids: string[]): Promise<UserSharedBirthday[]> {
    if (!ids.length) return [];
    const pages = await Promise.all(
      chunkIds(ids).map((chunk) =>
        this.supabase
          .from('users')
          .select('id, display_name, avatar_url, birthday_month, birthday_day')
          .in('id', chunk)
          .eq('birthday_visibility', 'chapter')
          .not('birthday_month', 'is', null)
          .not('birthday_day', 'is', null),
      ),
    );
    const rows: UserSharedBirthday[] = [];
    for (const { data, error } of pages) {
      if (error) throw new SupabaseQueryError(error);
      for (const row of data ?? []) {
        if (row.birthday_month == null || row.birthday_day == null) continue;
        rows.push({
          id: row.id,
          display_name: row.display_name,
          avatar_url: row.avatar_url,
          birthday_month: row.birthday_month,
          birthday_day: row.birthday_day,
        });
      }
    }
    return rows;
  }

  /**
   * `columns` for each id, read in chunks. Chunked, unlike `findByIds` above: a
   * chapter-sized id list in one `in (...)` overflows the request line and
   * returns 414 with nothing worth reading (see the measurement in
   * `domain/utils/chunk-ids`). A failed chunk fails the whole read.
   */
  private async findColumnsByIds<
    C extends 'id, display_name, avatar_url' | 'id, display_name, email',
  >(ids: string[], columns: C) {
    if (!ids.length) return [];
    const pages = await Promise.all(
      chunkIds(ids).map((chunk) =>
        this.supabase.from('users').select(columns).in('id', chunk),
      ),
    );
    const rows = [];
    for (const { data, error } of pages) {
      if (error) throw new SupabaseQueryError(error);
      rows.push(...(data ?? []));
    }
    return rows;
  }

  async findBySupabaseAuthId(authId: string): Promise<User | null> {
    const { data, error } = await this.supabase
      .from('users')
      .select('*')
      .eq('supabase_auth_id', authId)
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async create(userData: TablesInsert<'users'>): Promise<User> {
    const { data, error } = await this.supabase
      .from('users')
      .insert(userData)
      .select()
      .single();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async update(id: string, userData: TablesUpdate<'users'>): Promise<User> {
    const { data, error } = await this.supabase
      .from('users')
      .update(userData)
      .eq('id', id)
      // Hard backstop for the account-deletion race: the service-level
      // tombstone check is check-then-write, so a stalled request could
      // otherwise commit PII onto an anonymized row after deletion finished.
      // Filtering here makes the write itself refuse tombstones (zero rows →
      // PostgREST single() error) no matter how stale the caller's read was.
      .is('deleted_at', null)
      .select()
      .single();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async compareAndSetWhatsNewSeen(
    id: string,
    expected: string | null,
    next: string,
  ): Promise<boolean> {
    const base = this.supabase
      .from('users')
      .update({ whats_new_seen_version: next })
      .eq('id', id)
      .is('deleted_at', null);
    const guarded =
      expected === null
        ? base.is('whats_new_seen_version', null)
        : base.eq('whats_new_seen_version', expected);
    const { data, error } = await guarded.select('id');
    if (error) throw new SupabaseQueryError(error);
    return (data ?? []).length > 0;
  }

  async anonymize(id: string, rescanCards = false): Promise<User | null> {
    const { data, error } = await this.supabase.rpc('anonymize_user', {
      p_user_id: id,
      p_rescan_cards: rescanCards,
    });
    if (error) throw new SupabaseQueryError(error);
    const rows = data ?? [];
    return rows.length > 0 ? rows[0] : null;
  }
}
