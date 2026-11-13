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
import { IN_FILTER_CHAR_BUDGET, chunkIds } from '#domain/utils/chunk-ids';

function toNotificationInsert(
  data: TablesInsert<'notifications'>,
): TablesInsert<'notifications'> {
  return {
    chapter_id: data.chapter_id,
    user_id: data.user_id,
    title: data.title,
    body: data.body,
    data: data.data ?? {},
    ...(data.chat_message_id ? { chat_message_id: data.chat_message_id } : {}),
  };
}

@Injectable()
export class SupabaseNotificationRepository implements INotificationRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async create(
    data: TablesInsert<'notifications'>,
  ): Promise<Notification | null> {
    // `maybeSingle`: a chat row about a message deleted meanwhile is dropped
    // by a trigger, and the insert then returns no row rather than failing.
    const { data: created, error } = await this.supabase
      .from('notifications')
      .insert(toNotificationInsert(data))
      .select()
      .maybeSingle();

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

  async markChatChannelRead(
    userId: string,
    chapterId: string,
    channelId: string,
    readThrough: string,
    threadRootId?: string,
  ): Promise<void> {
    const patch: TablesUpdate<'notifications'> = { read_at: readThrough };
    // `read_at is null` keeps an earlier read's timestamp, and lets the
    // partial index `idx_notifications_unread` serve the scan. An update that
    // matches nothing sends no realtime ping: the statement trigger loops over
    // the changed rows.
    const query = this.supabase
      .from('notifications')
      .update(patch)
      .eq('user_id', userId)
      .eq('chapter_id', chapterId)
      .is('read_at', null)
      .eq('data->target->>screen', 'chat')
      .eq('data->target->>channelId', channelId)
      .lte('created_at', readThrough);
    // A thread reply's push targets its channel and its thread (#3785). A
    // channel read leaves those rows; a thread read clears only them.
    const scoped = threadRootId
      ? query.eq('data->target->>threadRootId', threadRootId)
      : query.is('data->target->>threadRootId', null);
    const { error } = await scoped;

    if (error) throw new SupabaseQueryError(error);
  }

  async markAllRead(
    userId: string,
    chapterId: string,
    readThrough: string,
    screens?: readonly string[],
    ids?: readonly string[],
  ): Promise<number> {
    const patch: TablesUpdate<'notifications'> = { read_at: readThrough };
    // `read_at is null` and the `created_at` bound, as in `markChatChannelRead`:
    // an earlier read keeps its own timestamp, and a row that lands after the
    // request began is one the member has not seen.
    let query = this.supabase
      .from('notifications')
      .update(patch)
      .eq('user_id', userId)
      .eq('chapter_id', chapterId)
      .is('read_at', null)
      .lte('created_at', readThrough);
    if (screens && screens.length > 0) {
      // The DTO admits only lowercase screen names, so nothing here needs
      // quoting inside the `in (...)` list.
      query = query.in('data->target->>screen', [...screens]);
    }
    if (ids && ids.length > 0) {
      // One inbox entry's rows (#3948); the DTO admits only UUIDs.
      query = query.in('id', [...ids]);
    }
    const { data, error } = await query.select('id');

    if (error) throw new SupabaseQueryError(error);
    return data?.length ?? 0;
  }

  async deleteMany(
    userId: string,
    chapterId: string,
    ids: readonly string[],
  ): Promise<number> {
    // Scoped to the caller and the chapter as well as the ids: the table is
    // RLS-on with no policy, so this filter is the whole of the check. The
    // statement-level delete trigger pings `notif:<user>`, so the member's
    // other devices refetch.
    const { data, error } = await this.supabase
      .from('notifications')
      .delete()
      .eq('user_id', userId)
      .eq('chapter_id', chapterId)
      .in('id', [...ids])
      .select('id');

    if (error) throw new SupabaseQueryError(error);
    return data?.length ?? 0;
  }

  async rewriteChatMessageBody(
    chapterId: string,
    messageId: string,
    body: string,
    userIds: readonly string[],
  ): Promise<void> {
    const patch: TablesUpdate<'notifications'> = { body };
    // A channel's readers can be a whole chapter, so the list is chunked to
    // keep each request's URL inside the `in (...)` budget.
    for (const chunk of chunkIds([...userIds])) {
      const { error } = await this.supabase
        .from('notifications')
        .update(patch)
        .eq('chapter_id', chapterId)
        .eq('chat_message_id', messageId)
        .in('user_id', chunk)
        .neq('body', body);

      if (error) throw new SupabaseQueryError(error);
    }
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
  const keepNonChat = [
    'data->target->>screen.is.null',
    'data->target->>screen.neq.chat',
  ];
  const quoted = senderIds.map(escapeFilterValue).join(',');
  // One ordered, limited query can't be chunked, and a list past the budget
  // would make the URL too long and fail the whole read (`chunk-ids.ts` has the
  // measurement). That takes a block list of about 80 members, so past it the
  // list withholds every chat row instead: the fail-closed side, and still a
  // history.
  if (encodeURIComponent(quoted).length > IN_FILTER_CHAR_BUDGET) {
    return keepNonChat.join(',');
  }
  return [...keepNonChat, `data->>senderId.not.in.(${quoted})`].join(',');
}
