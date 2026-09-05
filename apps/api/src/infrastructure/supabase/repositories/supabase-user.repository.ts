import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type {
  FrappSupabaseClient,
  TablesInsert,
  TablesUpdate,
} from '../database.types';
import { IUserRepository } from '#domain/repositories/user.repository.interface';
import { User, UserDisplayIdentity } from '#domain/entities/user.entity';
import { chunkIds } from '#domain/utils/chunk-ids';

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
    if (error) throw error;
    return data;
  }

  async findByIds(ids: string[]): Promise<User[]> {
    if (!ids.length) return [];
    const { data, error } = await this.supabase
      .from('users')
      .select('*')
      .in('id', ids);
    if (error) throw error;
    return data ?? [];
  }

  async findDisplayIdentitiesByIds(
    ids: string[],
  ): Promise<UserDisplayIdentity[]> {
    if (!ids.length) return [];
    // Chunked, unlike `findByIds` above: a chapter-sized id list in one
    // `in (...)` overflows the request line and returns 414 with nothing worth
    // reading (see the measurement in `domain/utils/chunk-ids`).
    const pages = await Promise.all(
      chunkIds(ids).map((chunk) =>
        this.supabase
          .from('users')
          .select('id, display_name, avatar_url')
          .in('id', chunk),
      ),
    );
    const rows: UserDisplayIdentity[] = [];
    for (const { data, error } of pages) {
      if (error) throw error;
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
    if (error) throw error;
    return data;
  }

  async findByEmail(email: string): Promise<User | null> {
    const { data, error } = await this.supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async create(userData: TablesInsert<'users'>): Promise<User> {
    const { data, error } = await this.supabase
      .from('users')
      .insert(userData)
      .select()
      .single();
    if (error) throw error;
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
    if (error) throw error;
    return data;
  }

  async anonymize(id: string, rescanCards = false): Promise<User | null> {
    const { data, error } = await this.supabase.rpc('anonymize_user', {
      p_user_id: id,
      p_rescan_cards: rescanCards,
    });
    if (error) throw error;
    const rows = data ?? [];
    return rows.length > 0 ? rows[0] : null;
  }
}
