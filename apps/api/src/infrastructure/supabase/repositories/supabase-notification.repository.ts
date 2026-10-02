import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type {
  FrappSupabaseClient,
  TablesInsert,
  TablesUpdate,
} from '../database.types';
import type { INotificationRepository } from '#domain/repositories/notification.repository.interface';
import type { Notification } from '#domain/entities/notification.entity';
import { SupabaseQueryError } from '../supabase-query-error';
import { escapeFilterValue } from '../supabase.utils';

function toNotificationInsert(
  data: TablesInsert<'notifications'>,
): TablesInsert<'notifications'> {
  return {
    chapter_id: data.chapter_id,
    user_id: data.user_id,
    title: data.title,
    body: data.body,
    data: data.data ?? {},
  };
}

@Injectable()
export class SupabaseNotificationRepository implements INotificationRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async create(data: TablesInsert<'notifications'>): Promise<Notification> {
    const { data: created, error } = await this.supabase
      .from('notifications')
      .insert(toNotificationInsert(data))
      .select()
      .single();

    if (error) throw new SupabaseQueryError(error);
    return created;
  }

  async createMany(
    data: TablesInsert<'notifications'>[],
  ): Promise<Notification[]> {
    // An empty insert is a no-op, not a query. PostgREST answers `insert([])`
    // with a 200 and no rows, so this only saves a round trip — but it also
    // keeps "the caller sent no recipients" from looking like a write in the
    // repository's call log, which is what the tenant-scope harness reads.
    if (data.length === 0) return [];

    const { data: created, error } = await this.supabase
      .from('notifications')
      .insert(data.map(toNotificationInsert))
      .select();

    if (error) throw new SupabaseQueryError(error);
    return created ?? [];
  }

  async findByUser(
    userId: string,
    chapterId: string,
    options?: { limit?: number; withholdChatFrom?: readonly string[] },
  ): Promise<Notification[]> {
    let query = this.supabase
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .eq('chapter_id', chapterId)
      .order('created_at', { ascending: false });

    const withheld = options?.withholdChatFrom ?? [];
    if (withheld.length > 0) {
      query = query.or(notChatFrom(withheld));
    }

    if (
      typeof options?.limit === 'number' &&
      Number.isFinite(options.limit) &&
      options.limit > 0
    ) {
      query = query.limit(options.limit);
    }

    const { data, error } = await query;
    if (error) throw new SupabaseQueryError(error);
    return data ?? [];
  }

  async findById(id: string, chapterId: string): Promise<Notification | null> {
    const { data, error } = await this.supabase
      .from('notifications')
      .select('*')
      .eq('id', id)
      .eq('chapter_id', chapterId)
      .maybeSingle();

    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async markRead(
    id: string,
    userId: string,
    chapterId: string,
  ): Promise<Notification> {
    const patch: TablesUpdate<'notifications'> = {
      read_at: new Date().toISOString(),
    };
    const { data, error } = await this.supabase
      .from('notifications')
      .update(patch)
      .eq('id', id)
      .eq('user_id', userId)
      .eq('chapter_id', chapterId)
      .select()
      .single();

    if (error) throw new SupabaseQueryError(error);
    return data;
  }
}

/**
 * The PostgREST `.or()` filter that keeps a row unless it is a chat row from one
 * of `senderIds` or a chat row with no recorded sender (#2715).
 *
 * Three-valued logic does the work, so read it before simplifying it:
 * - a row with no `target`, or no `screen`, is kept by `is.null`: a bare
 *   `neq.chat` is NULL on it, and NULL does not match;
 * - a non-chat row is kept by `neq.chat`;
 * - a chat row is kept only by the `not.in`, which is true for a sender outside
 *   the list and NULL, so not a match, for a row with no `senderId`. Every chat
 *   row written before the worker recorded senders is therefore withheld from a
 *   member who has blocked anyone in the chapter. Its sender can't be resolved
 *   (the row names the channel, not the message), and a list that can't be
 *   evaluated is not an empty one.
 *
 * The ids are block-list rows, never client input; they are quoted anyway, as
 * every `.or()` string in this layer is.
 */
function notChatFrom(senderIds: readonly string[]): string {
  const quoted = senderIds.map(escapeFilterValue).join(',');
  return [
    'data->target->>screen.is.null',
    'data->target->>screen.neq.chat',
    `data->>senderId.not.in.(${quoted})`,
  ].join(',');
}
