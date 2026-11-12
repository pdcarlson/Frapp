import { Inject, Injectable } from '@nestjs/common';
import type {
  CatchUpMessageRow,
  CatchUpStretch,
  IChatCatchUpRepository,
} from '#domain/repositories/chat-catch-up.repository.interface';
import type { FrappSupabaseClient } from '../database.types';
import { SUPABASE_CLIENT } from '../supabase.provider';
import { SupabaseQueryError } from '../supabase-query-error';

/**
 * The message's own channel, named by its foreign key (two relationships
 * link the tables, #4087), and required: a row whose channel fails the
 * filters below is not returned.
 */
const COLUMNS =
  'id, sender_id, content, created_at, thread_root_id, mentions, chat_channels!chat_messages_channel_id_fkey!inner(chapter_id, type, is_audit_log)';

/** The channel types members talk in. Never a DM or a group DM. */
const CHAPTER_CHANNEL_TYPES = ['PUBLIC', 'PRIVATE', 'ROLE_GATED'] as const;
/** The kinds a member wrote. Cards and system rows are not conversation. */
const WRITTEN_KINDS = ['text', 'announcement', 'imported'] as const;

interface Row extends CatchUpMessageRow {
  chat_channels?: unknown;
}

function toMessage(row: Row): CatchUpMessageRow {
  return {
    id: row.id,
    sender_id: row.sender_id,
    content: row.content,
    created_at: row.created_at,
    thread_root_id: row.thread_root_id,
    mentions: row.mentions,
  };
}

function oldestFirst(rows: CatchUpMessageRow[]): CatchUpMessageRow[] {
  return [...rows].sort(
    (a, b) =>
      Date.parse(a.created_at) - Date.parse(b.created_at) ||
      a.id.localeCompare(b.id),
  );
}

/** Catch me up's reads (#3946). See the interface for what each refuses. */
@Injectable()
export class SupabaseChatCatchUpRepository implements IChatCatchUpRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  /** A channel's written, undeleted messages, in a chapter channel only. */
  private written(chapterId: string, channelId: string) {
    return this.supabase
      .from('chat_messages')
      .select(COLUMNS, { count: 'exact' })
      .eq('channel_id', channelId)
      .eq('chat_channels.chapter_id', chapterId)
      .in('chat_channels.type', CHAPTER_CHANNEL_TYPES)
      .eq('chat_channels.is_audit_log', false)
      .eq('is_deleted', false)
      .in('kind', WRITTEN_KINDS)
      .neq('content', '');
  }

  async unreadStart(input: {
    chapterId: string;
    channelId: string;
    userId: string;
    count: number;
    asOf: string;
  }): Promise<string | null> {
    const { data, error } = await this.supabase
      .from('chat_messages')
      .select(
        'created_at, chat_channels!chat_messages_channel_id_fkey!inner(chapter_id, type, is_audit_log)',
      )
      .eq('channel_id', input.channelId)
      .eq('chat_channels.chapter_id', input.chapterId)
      .in('chat_channels.type', CHAPTER_CHANNEL_TYPES)
      .eq('chat_channels.is_audit_log', false)
      .is('thread_root_id', null)
      .eq('is_deleted', false)
      .neq('kind', 'imported')
      .or(`sender_id.is.null,sender_id.neq.${input.userId}`)
      .lte('created_at', input.asOf)
      .order('created_at', { ascending: false })
      .range(input.count - 1, input.count - 1);
    if (error) throw new SupabaseQueryError(error);
    return data?.[0]?.created_at ?? null;
  }

  async readChannelSince(input: {
    chapterId: string;
    channelId: string;
    since: string;
    limit: number;
  }): Promise<CatchUpStretch> {
    const { data, error, count } = await this.written(
      input.chapterId,
      input.channelId,
    )
      .gte('created_at', input.since)
      .order('created_at', { ascending: false })
      .limit(input.limit);
    if (error) throw new SupabaseQueryError(error);
    const rows = (data ?? []) as Row[];
    return {
      messages: oldestFirst(rows.map(toMessage)),
      total: count ?? rows.length,
    };
  }

  async readThread(input: {
    chapterId: string;
    channelId: string;
    rootId: string;
    limit: number;
  }): Promise<CatchUpStretch | null> {
    const root = await this.written(input.chapterId, input.channelId)
      .eq('id', input.rootId)
      .is('thread_root_id', null)
      .maybeSingle();
    if (root.error) throw new SupabaseQueryError(root.error);
    if (!root.data) return null;

    const replies = await this.written(input.chapterId, input.channelId)
      .eq('thread_root_id', input.rootId)
      .order('created_at', { ascending: false })
      // The first message is always read, so the replies get one fewer.
      .limit(Math.max(input.limit - 1, 0));
    if (replies.error) throw new SupabaseQueryError(replies.error);
    const rows = (replies.data ?? []) as Row[];
    return {
      messages: [
        toMessage(root.data as Row),
        ...oldestFirst(rows.map(toMessage)),
      ],
      total: 1 + (replies.count ?? rows.length),
    };
  }
}
