import { Inject, Injectable } from '@nestjs/common';
import { escapeFilterValue } from '../supabase.utils';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type {
  FrappSupabaseClient,
  TablesInsert,
  TablesUpdate,
} from '../database.types';
import type { IChatMessageRepository } from '../../../domain/repositories/chat.repository.interface';
import {
  ChatMessageDuplicateError,
  PG_UNIQUE_VIOLATION,
} from '../../../domain/repositories/chat.repository.interface';
import { ChatMessage } from '../../../domain/entities/chat.entity';
import {
  LIST_QUERY_LIMIT_DEFAULT,
  LIST_QUERY_LIMIT_MAX,
  LIST_QUERY_LIMIT_MIN,
} from '../../../domain/constants/list-query-limits';

const DEFAULT_MESSAGE_LIMIT = 50;

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
 */
const CHAT_MESSAGE_COLUMNS =
  'id, channel_id, sender_id, author_name, author_avatar_path, author_external_id, content, type, kind, payload, client_message_id, reply_to_id, metadata, mentions, is_pinned, pinned_at, edited_at, is_deleted, created_at' as const;

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
    if (error) throw error;
    return data;
  }

  async findByChannel(
    channelId: string,
    options?: { limit?: number; before?: string; since?: string },
  ): Promise<ChatMessage[]> {
    let query = this.supabase
      .from('chat_messages')
      .select(CHAT_MESSAGE_COLUMNS)
      .eq('channel_id', channelId)
      .order('created_at', { ascending: false })
      .limit(options?.limit ?? DEFAULT_MESSAGE_LIMIT);

    if (options?.before) {
      query = query.lt('created_at', options.before);
    }

    // `since` is a message UUID: return messages created AFTER that message
    // (reconnect replay path — client already has the `since` message).
    // Scope the pivot lookup to this channel so a UUID from another channel
    // can't shift the window.
    if (options?.since) {
      const { data: pivot, error: pivotError } = await this.supabase
        .from('chat_messages')
        .select('created_at')
        .eq('id', options.since)
        .eq('channel_id', channelId)
        .maybeSingle();
      if (pivotError) throw pivotError;
      if (pivot) {
        query = query.gt('created_at', pivot.created_at);
      }
    }

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  async findPinnedByChannel(channelId: string): Promise<ChatMessage[]> {
    const { data, error } = await this.supabase
      .from('chat_messages')
      .select(CHAT_MESSAGE_COLUMNS)
      .eq('channel_id', channelId)
      .eq('is_pinned', true)
      .order('pinned_at', { ascending: false });
    if (error) throw error;
    return data || [];
  }

  async countPinnedByChannel(channelId: string): Promise<number> {
    const { count, error } = await this.supabase
      .from('chat_messages')
      .select('*', { count: 'exact', head: true })
      .eq('channel_id', channelId)
      .eq('is_pinned', true);
    if (error) throw error;
    return count ?? 0;
  }

  async findPollsByChapter(
    chapterId: string,
    options?: { channelId?: string; limit?: number; active?: boolean },
  ): Promise<ChatMessage[]> {
    // chat_messages doesn't carry chapter_id directly — filter via the
    // chat_channels foreign key relationship. Supabase projects the
    // inner-joined chat_channels row back but we only care about the
    // message columns.
    let query = this.supabase
      .from('chat_messages')
      .select(`${CHAT_MESSAGE_COLUMNS}, chat_channels!inner(chapter_id)`)
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
        query = query.or(
          `metadata->>expires_at.is.null,metadata->>expires_at.gt.${safeNowForOr}`,
        );
      } else {
        query = query
          .not('metadata->>expires_at', 'is', null)
          .filter('metadata->>expires_at', 'lte', nowIso);
      }
    }

    query = query.limit(effectivePollListLimit(options?.limit));

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
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
    if (error) throw error;
    return data;
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
      // `sender_id` is checked for `undefined`, not truthiness. A null sender is
      // a legitimate insert (an imported archive row) and the index enforces on
      // it — `NULLS NOT DISTINCT`, see 20260823120000_chat_message_authors.sql —
      // so a truthiness guard here would let exactly the re-run-importer
      // collision the index exists to catch escape as a raw 23505.
      if (
        (error as { code?: string }).code === PG_UNIQUE_VIOLATION &&
        data.channel_id &&
        data.sender_id !== undefined &&
        data.client_message_id
      ) {
        throw new ChatMessageDuplicateError(
          data.channel_id,
          data.sender_id,
          data.client_message_id,
        );
      }
      throw error;
    }
    return created;
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
    if (error) throw error;
    return updated;
  }
}
