import type { ChatMessageFlag } from '@repo/validation';
import { Inject, Injectable } from '@nestjs/common';
import { escapeFilterValue } from '../supabase.utils';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type {
  FrappSupabaseClient,
  TablesInsert,
  TablesUpdate,
} from '../database.types';
import type { IChatMessageRepository } from '#domain/repositories/chat.repository.interface';
import {
  ChatMessageCursorNotFoundError,
  ChatMessageDuplicateError,
} from '#domain/repositories/chat.repository.interface';
import { PG_UNIQUE_VIOLATION } from '#domain/constants/postgres-error-codes';
import {
  ChannelLatestMessage,
  ChatMessage,
} from '#domain/entities/chat.entity';
import {
  LIST_QUERY_LIMIT_DEFAULT,
  LIST_QUERY_LIMIT_MAX,
  LIST_QUERY_LIMIT_MIN,
} from '#domain/constants/list-query-limits';
import { SupabaseQueryError } from '../supabase-query-error';

const DEFAULT_MESSAGE_LIMIT = 50;

/** The `idx_chat_messages_dedupe` key, present on every field. */
type DedupeKeyedInsert = TablesInsert<'chat_messages'> & {
  channel_id: string;
  sender_id: string | null;
  client_message_id: string;
};

/**
 * Whether a failed insert reads as a hit on `idx_chat_messages_dedupe`
 * (`channel_id, sender_id, client_message_id`): a 23505 on a row that carries
 * that whole key. Shared by `create` and `insertIdempotent` so the two cannot
 * disagree about what "already landed" means.
 *
 * It infers the index from the row, not from the error, so a row that also
 * supplies `id` or `external_message_id` and collides on one of those is
 * misread as a dedupe hit. No writer does that today: the live send and the
 * audit bridge set neither, and the importer sets no `client_message_id`.
 *
 * `sender_id` is checked for `undefined` rather than truthiness. A null sender
 * is a legitimate insert (an imported archive row), and a truthiness guard
 * would silently stop translating for any future null-sender writer that sets
 * a `client_message_id`.
 */
function isDedupeHit(
  error: { code?: string } | null,
  data: TablesInsert<'chat_messages'>,
): data is DedupeKeyedInsert {
  return (
    error?.code === PG_UNIQUE_VIOLATION &&
    !!data.channel_id &&
    data.sender_id !== undefined &&
    !!data.client_message_id
  );
}

function effectivePollListLimit(requested?: number): number {
  if (requested === undefined || !Number.isFinite(requested)) {
    return LIST_QUERY_LIMIT_DEFAULT;
  }
  const n = Math.trunc(requested);
  if (n <= 0) {
    return LIST_QUERY_LIMIT_MIN;
  }
  return Math.max(LIST_QUERY_LIMIT_MIN, Math.min(n, LIST_QUERY_LIMIT_MAX));
}

/**
 * Every `chat_messages` column a client is served — deliberately NOT `*`.
 *
 * `content_search` is a STORED generated tsvector (20260823122000), and
 * PostgREST's `*` includes generated columns. A 50-message page would otherwise
 * ship 50 serialized lexeme vectors that nothing reads: `RawChatMessage` does
 * not declare the field and `normalizeRow` drops it. The cost scales with
 * exactly the archive import this column was added for.
 *
 * Adding a column to `chat_messages` means adding it here too. That is the
 * trade for not shipping the index payload to every reader.
 *
 * `external_message_id` is the deliberate exception, for the same reason
 * `content_search` is: no client reads it. It is a Discord snowflake used by the
 * importer's dedupe index and by the reply-resolution pass, both of which select
 * it explicitly. `RawChatMessage` in `@repo/chat-core` does not declare it and
 * `normalizeRow` would drop it, so listing it here would add bytes to every
 * message page for a field that is discarded on arrival.
 */
export const CHAT_MESSAGE_COLUMNS =
  'id, channel_id, sender_id, author_name, author_avatar_path, author_external_id, content, type, kind, payload, client_message_id, reply_to_id, metadata, mentions, thread_root_id, thread_reply_count, thread_last_reply_at, thread_recent_sender_ids, is_pinned, pinned_at, flag, flagged_by, flagged_at, edited_at, is_deleted, created_at' as const;

@Injectable()
export class SupabaseChatMessageRepository implements IChatMessageRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async findById(id: string): Promise<ChatMessage | null> {
    const { data, error } = await this.supabase
      .from('chat_messages')
      .select(CHAT_MESSAGE_COLUMNS)
      .eq('id', id)
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async findLatestPerChannel(
    chapterId: string,
    userId: string,
  ): Promise<ChannelLatestMessage[]> {
    const { data, error } = await this.supabase.rpc(
      'get_channel_latest_messages',
      { p_chapter_id: chapterId, p_user_id: userId },
    );
    if (error) throw new SupabaseQueryError(error);
    return (data ?? []).map((row) => ({
      ...row,
      // An `integer` from the RPC, but the count decides between "Attachment"
      // and "3 attachments", so coerce rather than trust the wire type.
      attachment_count: Number(row.attachment_count) || 0,
    }));
  }

  async findByChannel(
    channelId: string,
    options?: { limit?: number; before?: string; since?: string },
  ): Promise<ChatMessage[]> {
    let query = this.supabase
      .from('chat_messages')
      .select(CHAT_MESSAGE_COLUMNS)
      .eq('channel_id', channelId)
      // The timeline only: a thread reply lives in its thread (#3785), read
      // through `SupabaseChatThreadRepository.findReplies`.
      .is('thread_root_id', null)
      .order('created_at', { ascending: false })
      .limit(options?.limit ?? DEFAULT_MESSAGE_LIMIT);

    if (options?.before) {
      query = query.lt('created_at', options.before);
    }

    // `since` is a message UUID: messages created AFTER that message, for the
    // reconnect and poll backfill (the client already holds the `since`
    // message). Still newest first under the same limit, so a full page is
    // the newest `limit` rows after the cursor and may not reach back to it;
    // the client treats it that way (`mergeSincePage` in chat-core, #2807).
    //
    // The pivot lookup is scoped to this channel so a UUID from another
    // channel can't shift the window, and a cursor that finds nothing is
    // refused rather than ignored: ignoring it answered with the channel's
    // newest page, which a client merged as "everything after my cursor".
    if (options?.since) {
      const { data: pivot, error: pivotError } = await this.supabase
        .from('chat_messages')
        .select('created_at')
        .eq('id', options.since)
        .eq('channel_id', channelId)
        .maybeSingle();
      if (pivotError) throw new SupabaseQueryError(pivotError);
      if (!pivot) {
        throw new ChatMessageCursorNotFoundError(channelId, options.since);
      }
      // Strictly after the pivot's instant. A row tied with it would be
      // skipped, but no write path produces one a cursor can sit on: live
      // rows are single-row inserts, and imported batches never reach a
      // cursor over Realtime. `gte` was tried and cost more than it guarded
      // (#3055).
      query = query.gt('created_at', pivot.created_at);
    }

    const { data, error } = await query;
    if (error) throw new SupabaseQueryError(error);
    return data || [];
  }

  async findPinnedByChannel(channelId: string): Promise<ChatMessage[]> {
    const { data, error } = await this.supabase
      .from('chat_messages')
      .select(CHAT_MESSAGE_COLUMNS)
      .eq('channel_id', channelId)
      .eq('is_pinned', true)
      .order('pinned_at', { ascending: false });
    if (error) throw new SupabaseQueryError(error);
    return data || [];
  }

  /**
   * A channel's live timeline messages flagged Important since `flaggedSince`,
   * most recently flagged first, for the Important strip (#4186). Thread
   * replies and deleted messages never count, which is also the partial
   * index's predicate (`idx_chat_messages_channel_important`).
   */
  async findImportantInChannel(
    channelId: string,
    flaggedSince: string,
    limit: number,
  ): Promise<ChatMessage[]> {
    const { data, error } = await this.supabase
      .from('chat_messages')
      .select(CHAT_MESSAGE_COLUMNS)
      .eq('channel_id', channelId)
      .eq('flag', 'important')
      .eq('is_deleted', false)
      .is('thread_root_id', null)
      .gte('flagged_at', flaggedSince)
      .order('flagged_at', { ascending: false })
      .limit(limit);
    if (error) throw new SupabaseQueryError(error);
    return data || [];
  }

  async countPinnedByChannel(channelId: string): Promise<number> {
    const { count, error } = await this.supabase
      .from('chat_messages')
      .select('*', { count: 'exact', head: true })
      .eq('channel_id', channelId)
      .eq('is_pinned', true);
    if (error) throw new SupabaseQueryError(error);
    return count ?? 0;
  }

  async findPollsByChapter(
    chapterId: string,
    options?: { channelId?: string; limit?: number; active?: boolean },
  ): Promise<ChatMessage[]> {
    // chat_messages doesn't carry chapter_id directly — filter via the
    // chat_channels foreign key relationship. Supabase projects the
    // inner-joined chat_channels row back but we only care about the
    // message columns. The FK is named because `chat_channels` also points
    // at `chat_messages` (`background_message_id`), and PostgREST refuses a
    // bare embed between two tables with two relationships (PGRST201, #4087).
    let query = this.supabase
      .from('chat_messages')
      .select(
        `${CHAT_MESSAGE_COLUMNS}, chat_channels!chat_messages_channel_id_fkey!inner(chapter_id)`,
      )
      .eq('type', 'POLL')
      .eq('chat_channels.chapter_id', chapterId)
      .order('created_at', { ascending: false });

    if (options?.channelId) {
      query = query.eq('channel_id', options.channelId);
    }

    if (options?.active === true || options?.active === false) {
      const nowIso = new Date().toISOString();
      // PostgREST `.or()` strings need explicit quoting; `.filter()` encodes values.
      const safeNowForOr = escapeFilterValue(nowIso);
      if (options.active === true) {
        // "Active" means neither expired nor manually closed (#379). The two
        // are independent columns in `metadata`, so this is an AND of two
        // conditions — `.is()` and `.or()` each add their own top-level filter,
        // which PostgREST (and this query builder) already ANDs together; no
        // nested `and()` inside the `.or()` string is needed.
        query = query
          .is('metadata->>closed_at', null)
          .or(
            `metadata->>expires_at.is.null,metadata->>expires_at.gt.${safeNowForOr}`,
          );
      } else {
        // "Inactive" means closed OR expired — a single flat OR. `expires_at
        // <= now` already excludes a null `expires_at` under normal SQL NULL
        // semantics (`NULL <= x` is not true), so no separate "is not null"
        // guard is needed on that leg, and this query builder's `.or()` cannot
        // express a nested `and(...)` group anyway.
        query = query.or(
          `metadata->>closed_at.not.is.null,metadata->>expires_at.lte.${safeNowForOr}`,
        );
      }
    }

    query = query.limit(effectivePollListLimit(options?.limit));

    const { data, error } = await query;
    if (error) throw new SupabaseQueryError(error);
    return data || [];
  }

  async findPollCardsByChapter(
    chapterId: string,
    options: { senderId?: string; limit: number },
  ): Promise<ChatMessage[]> {
    // Chapter scope through the channel join, as `findPollsByChapter` does:
    // `chat_messages` carries no `chapter_id` of its own.
    let query = this.supabase
      .from('chat_messages')
      .select(
        `${CHAT_MESSAGE_COLUMNS}, chat_channels!chat_messages_channel_id_fkey!inner(chapter_id)`,
      )
      .eq('kind', 'poll')
      .eq('is_deleted', false)
      .eq('chat_channels.chapter_id', chapterId)
      .order('created_at', { ascending: false });

    if (options.senderId) {
      query = query.eq('sender_id', options.senderId);
    }

    const { data, error } = await query.limit(options.limit);
    if (error) throw new SupabaseQueryError(error);
    // The joined channel is only the chapter filter. It is dropped here so a
    // caller that serves the row serves a chat message and nothing else.
    return (data || []).map((row) => {
      const message: ChatMessage & { chat_channels?: unknown } = { ...row };
      delete message.chat_channels;
      return message;
    });
  }

  async findByClientMessageId(
    channelId: string,
    senderId: string | null,
    clientMessageId: string,
  ): Promise<ChatMessage | null> {
    const query = this.supabase
      .from('chat_messages')
      .select(CHAT_MESSAGE_COLUMNS)
      .eq('channel_id', channelId)
      .eq('client_message_id', clientMessageId);

    // `.eq('sender_id', null)` renders as `sender_id=eq.null`, which PostgREST
    // matches against nothing — SQL `= NULL` is never true. The archive
    // importer writes rows with no sender, so the dedupe re-select has to spell
    // that arm as `IS NULL` or it reports "no existing row" for a row that is
    // right there and the caller re-raises the unique violation as a 5xx.
    const scoped =
      senderId === null
        ? query.is('sender_id', null)
        : query.eq('sender_id', senderId);

    const { data, error } = await scoped.maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async findAuthorAvatarPaths(
    channelId: string,
    messageIds: string[],
  ): Promise<string[]> {
    if (messageIds.length === 0) return [];
    const { data, error } = await this.supabase
      .from('chat_messages')
      .select('author_avatar_path')
      .eq('channel_id', channelId)
      .in('id', messageIds)
      .not('author_avatar_path', 'is', null);
    if (error) throw new SupabaseQueryError(error);
    return [
      ...new Set(
        (data ?? [])
          .map((row) => row.author_avatar_path)
          .filter((path): path is string => !!path),
      ),
    ];
  }

  async create(data: TablesInsert<'chat_messages'>): Promise<ChatMessage> {
    const { data: created, error } = await this.supabase
      .from('chat_messages')
      .insert(data)
      .select()
      .single();
    if (error) {
      // Translate the partial-unique-index hit on (channel_id, sender_id,
      // client_message_id) into a typed error so the service can re-select
      // and return the existing row instead of surfacing a 5xx.
      //
      // This covers the *live send* retry only. The importer's collision is a
      // different index — `idx_chat_messages_external_dedupe` on
      // (channel_id, external_message_id), see 20260824120000_discord_import.sql
      // — and a different write path: it reads which snowflakes already exist
      // and inserts only the rest, so a re-run never reaches this translation
      // at all. (It cannot upsert: PostgREST will not use a partial unique
      // index as an ON CONFLICT arbiter.)
      if (isDedupeHit(error, data)) {
        throw new ChatMessageDuplicateError(
          data.channel_id,
          data.sender_id,
          data.client_message_id,
        );
      }
      throw new SupabaseQueryError(error);
    }
    return created;
  }

  async insertIdempotent(
    data: TablesInsert<'chat_messages'>,
  ): Promise<'inserted' | 'duplicate'> {
    const { error } = await this.supabase.from('chat_messages').insert(data);
    // `create`'s guard: on a row without the whole dedupe key, a 23505 is
    // some other unique index and an error, not a row that already landed.
    if (isDedupeHit(error, data)) return 'duplicate';
    if (error) throw new SupabaseQueryError(error);
    return 'inserted';
  }

  async compareAndSetFlag(
    id: string,
    expected: {
      flag: ChatMessageFlag | null;
      flagged_by: string | null;
      requireLive: boolean;
    },
    data: Pick<
      TablesUpdate<'chat_messages'>,
      'flag' | 'flagged_by' | 'flagged_at'
    >,
  ): Promise<ChatMessage | null> {
    let query = this.supabase.from('chat_messages').update(data).eq('id', id);
    query =
      expected.flag === null
        ? query.is('flag', null)
        : query.eq('flag', expected.flag);
    query =
      expected.flagged_by === null
        ? query.is('flagged_by', null)
        : query.eq('flagged_by', expected.flagged_by);
    if (expected.requireLive) query = query.eq('is_deleted', false);
    const { data: updated, error } = await query
      .select(CHAT_MESSAGE_COLUMNS)
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return updated;
  }

  async update(
    id: string,
    data: TablesUpdate<'chat_messages'>,
  ): Promise<ChatMessage> {
    const { data: updated, error } = await this.supabase
      .from('chat_messages')
      .update(data)
      .eq('id', id)
      .select()
      .single();
    if (error) throw new SupabaseQueryError(error);
    return updated;
  }
}
