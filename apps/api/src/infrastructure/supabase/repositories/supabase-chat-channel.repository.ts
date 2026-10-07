import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import { fetchAllPages } from '../supabase.utils';
import type {
  FrappSupabaseClient,
  TablesInsert,
  TablesUpdate,
} from '../database.types';
import type { IChatChannelRepository } from '#domain/repositories/chat.repository.interface';
import { ChatChannel } from '#domain/entities/chat.entity';
import { PG_UNIQUE_VIOLATION } from '#domain/constants/postgres-error-codes';
import { SupabaseQueryError } from '../supabase-query-error';

/**
 * A DM's member ids as Postgres returns a `uuid[]`: lowercase, sorted. The
 * route accepts any `@IsUUID()`, uppercase included, and `findDm` compares the
 * stored ids as strings, so an uppercase id would never match its own pair.
 * Now that `createDm` re-reads the pair after a `23505`, that miss would be a
 * 500 on every retry rather than a duplicate DM.
 */
function dmPair(memberIds: string[]): string[] {
  return memberIds.map((id) => id.toLowerCase()).sort();
}

@Injectable()
export class SupabaseChatChannelRepository implements IChatChannelRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async findById(id: string, chapterId: string): Promise<ChatChannel | null> {
    const { data, error } = await this.supabase
      .from('chat_channels')
      .select('*')
      .eq('id', id)
      .eq('chapter_id', chapterId)
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async findByChapter(chapterId: string): Promise<ChatChannel[]> {
    const { data, error } = await this.supabase
      .from('chat_channels')
      .select('*')
      .eq('chapter_id', chapterId)
      .order('created_at', { ascending: true });
    if (error) throw new SupabaseQueryError(error);
    return data || [];
  }

  async findRoleGates(
    chapterId: string,
  ): Promise<{ id: string; required_permissions: string[] }[]> {
    // Paged over the primary key: PostgREST caps a response at 1000 rows with
    // no error, and a gate missed here is a permission string reissued to a
    // role that then reads a channel nobody chose for it.
    const rows = await fetchAllPages(
      (from, to) =>
        this.supabase
          .from('chat_channels')
          .select('id, required_permissions')
          .eq('chapter_id', chapterId)
          .eq('type', 'ROLE_GATED')
          .order('id', { ascending: true })
          .range(from, to),
      { pageSize: 1000 },
    );
    return rows.map((row) => ({
      id: row.id,
      required_permissions: row.required_permissions ?? [],
    }));
  }

  async findByIds(chapterId: string, ids: string[]): Promise<ChatChannel[]> {
    if (!ids.length) return [];
    // `chapter_id` is load-bearing, not defensive: `filterAccessibleChannelIds`
    // asserts `isChapterMember` from membership on this chapter alone. An
    // unscoped `.in('id', ids)` would return foreign PUBLIC channels as accessible.
    const { data, error } = await this.supabase
      .from('chat_channels')
      .select('*')
      .eq('chapter_id', chapterId)
      .in('id', ids);
    if (error) throw new SupabaseQueryError(error);
    return data || [];
  }

  async findDm(
    chapterId: string,
    memberIds: string[],
  ): Promise<ChatChannel | null> {
    const sorted = dmPair(memberIds);
    const { data, error } = await this.supabase
      .from('chat_channels')
      .select('*')
      .eq('chapter_id', chapterId)
      .eq('type', 'DM')
      .contains('member_ids', sorted);
    if (error) throw new SupabaseQueryError(error);
    const match = (data as ChatChannel[])?.find(
      (ch) =>
        ch.member_ids &&
        ch.member_ids.length === sorted.length &&
        [...ch.member_ids].sort().every((id, i) => id === sorted[i]),
    );
    return match ?? null;
  }

  /**
   * Insert, and translate a hit on `chat_channels_dm_pair_key` into "here is
   * the DM the other call created" (#2788).
   *
   * **Not an upsert, and it cannot be one.** The index is unique on
   * `(chapter_id, least(member_ids[1], member_ids[2]),
   * greatest(member_ids[1], member_ids[2]))` where `type = 'DM'`, and PostgREST
   * will not use an expression or partial index as an `ON CONFLICT` arbiter
   * (`SupabaseChatMessageReportRepository.create` hits the same limit).
   *
   * So: insert, and on `23505` re-select the pair. A DM insert names no id, and
   * the pair index is the only other unique key on the table, so a `23505` here
   * means this pair's DM exists. A null re-select means that DM was deleted
   * between the failed insert and the read; surfacing the original error is
   * the honest answer, and a retry then creates it.
   */
  async createDm(chapterId: string, memberIds: string[]): Promise<ChatChannel> {
    const sorted = dmPair(memberIds);
    const { data, error } = await this.supabase
      .from('chat_channels')
      .insert({
        chapter_id: chapterId,
        name: `dm-${sorted.join('-')}`,
        type: 'DM',
        member_ids: sorted,
      })
      .select()
      .single();

    if (error) {
      if (error.code === PG_UNIQUE_VIOLATION) {
        const winner = await this.findDm(chapterId, sorted);
        if (winner) return winner;
      }
      throw new SupabaseQueryError(error);
    }

    return data;
  }

  async findByName(
    chapterId: string,
    name: string,
  ): Promise<ChatChannel | null> {
    const { data, error } = await this.supabase
      .from('chat_channels')
      .select('*')
      .eq('chapter_id', chapterId)
      .eq('name', name)
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async createMany(rows: TablesInsert<'chat_channels'>[]): Promise<void> {
    const { error } = await this.supabase.from('chat_channels').insert(rows);
    if (error) throw new SupabaseQueryError(error);
  }

  async create(data: TablesInsert<'chat_channels'>): Promise<ChatChannel> {
    const { data: created, error } = await this.supabase
      .from('chat_channels')
      .insert(data)
      .select()
      .single();
    if (error) throw new SupabaseQueryError(error);
    return created;
  }

  async update(
    id: string,
    chapterId: string,
    data: TablesUpdate<'chat_channels'>,
  ): Promise<ChatChannel> {
    const { data: updated, error } = await this.supabase
      .from('chat_channels')
      .update(data)
      .eq('id', id)
      .eq('chapter_id', chapterId)
      .select()
      .single();
    if (error) throw new SupabaseQueryError(error);
    return updated;
  }

  async delete(id: string, chapterId: string): Promise<void> {
    const { error } = await this.supabase
      .from('chat_channels')
      .delete()
      .eq('id', id)
      .eq('chapter_id', chapterId);
    if (error) throw new SupabaseQueryError(error);
  }

  /**
   * Atomic leave (#348) via the `leave_group_dm` RPC — see its migration
   * comment for why a plain app-side read-modify-write `update()` is unsafe
   * under concurrent leaves. `null` means the RPC matched zero rows (wrong
   * chapter, or the channel is no longer a GROUP_DM); the caller has already
   * proven both via `assertChannelAccess` immediately before calling this, so
   * that should not happen outside a genuine race with a concurrent
   * `deleteChannel`/`updateChannel` — treated as "not found" either way.
   */
  async leaveGroupDm(
    channelId: string,
    chapterId: string,
    userId: string,
  ): Promise<ChatChannel | null> {
    const { data, error } = await this.supabase.rpc('leave_group_dm', {
      p_channel_id: channelId,
      p_chapter_id: chapterId,
      p_user_id: userId,
    });
    if (error) throw new SupabaseQueryError(error);
    return (data ?? [])[0] ?? null;
  }

  /**
   * `array_append` in SQL rather than read-then-`update()`, for the reason
   * {@link leaveGroupDm} gives: two officers adding different members at once
   * would otherwise each write their own array and drop the other's add. See
   * `20260928170000_chat_private_channel_members.sql`.
   */
  async addPrivateChannelMember(
    channelId: string,
    chapterId: string,
    userId: string,
  ): Promise<ChatChannel | null> {
    const { data, error } = await this.supabase.rpc(
      'add_private_channel_member',
      { p_channel_id: channelId, p_chapter_id: chapterId, p_user_id: userId },
    );
    if (error) throw new SupabaseQueryError(error);
    return (data ?? [])[0] ?? null;
  }

  /**
   * The RPC holds the last-member guard in its `WHERE`, so two concurrent
   * removals of a channel's last two current members cannot both succeed.
   */
  async removePrivateChannelMember(
    channelId: string,
    chapterId: string,
    userId: string,
  ): Promise<ChatChannel | null> {
    const { data, error } = await this.supabase.rpc(
      'remove_private_channel_member',
      { p_channel_id: channelId, p_chapter_id: chapterId, p_user_id: userId },
    );
    if (error) throw new SupabaseQueryError(error);
    return (data ?? [])[0] ?? null;
  }

  async removeUserFromPrivateChannels(
    chapterId: string,
    userId: string,
  ): Promise<string[]> {
    const { data, error } = await this.supabase.rpc(
      'remove_user_from_private_channels',
      { p_chapter_id: chapterId, p_user_id: userId },
    );
    if (error) throw new SupabaseQueryError(error);
    return data ?? [];
  }
}
