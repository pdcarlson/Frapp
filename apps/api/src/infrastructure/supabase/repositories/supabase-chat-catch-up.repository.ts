import { Inject, Injectable } from '@nestjs/common';
import type {
  CatchUpMessagePlace,
  CatchUpMessageRow,
  CatchUpStretch,
  IChatCatchUpRepository,
} from '#domain/repositories/chat-catch-up.repository.interface';
import {
  CHAPTER_CHANNEL_TYPES,
  WRITTEN_MESSAGE_KINDS,
} from '#domain/utils/chat-catch-up';
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

const WRITTEN_KINDS = WRITTEN_MESSAGE_KINDS;

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

  /**
   * Which of these thread roots are a recruitment candidate's card. The
   * replies under one are talk about a prospect, and no rush data reaches a
   * model (`spec/behavior/ai.md`), so a stretch leaves them out.
   */
  private async rushRootIds(
    rootIds: readonly string[],
  ): Promise<ReadonlySet<string>> {
    if (rootIds.length === 0) return new Set();
    const { data, error } = await this.supabase
      .from('chat_messages')
      .select('id')
      .in('id', [...rootIds])
      .eq('kind', 'rush');
    if (error) throw new SupabaseQueryError(error);
    return new Set((data ?? []).map((row) => row.id));
  }

  async unreadStart(input: {
    chapterId: string;
    channelId: string;
    userId: string;
    count: number;
    asOf: string;
    blockedUserIds: readonly string[];
  }): Promise<string | null> {
    const others = [input.userId, ...input.blockedUserIds];
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
      .or(`sender_id.is.null,sender_id.not.in.(${others.join(',')})`)
      .lte('created_at', input.asOf)
      .order('created_at', { ascending: false })
      .range(input.count - 1, input.count - 1);
    if (error) throw new SupabaseQueryError(error);
    return data?.[0]?.created_at ?? null;
  }

  readChannelSince(input: {
    chapterId: string;
    channelId: string;
    since: string;
    limit: number;
  }): Promise<CatchUpStretch> {
    return this.readChannelWindow({
      chapterId: input.chapterId,
      channelId: input.channelId,
      from: input.since,
      limit: input.limit,
      keep: 'newest',
    });
  }

  async readChannelWindow(input: {
    chapterId: string;
    channelId: string;
    from?: string;
    before?: string;
    limit: number;
    keep: 'newest' | 'oldest';
  }): Promise<CatchUpStretch> {
    let query = this.written(input.chapterId, input.channelId);
    if (input.from !== undefined) query = query.gte('created_at', input.from);
    if (input.before !== undefined) {
      query = query.lt('created_at', input.before);
    }
    const { data, error, count } = await query
      .order('created_at', { ascending: input.keep === 'oldest' })
      .limit(input.limit);
    if (error) throw new SupabaseQueryError(error);
    const fetched = (data ?? []) as Row[];
    const rush = await this.rushRootIds([
      ...new Set(
        fetched
          .map((row) => row.thread_root_id)
          .filter((id): id is string => id !== null),
      ),
    ]);
    const rows = fetched.filter(
      (row) => row.thread_root_id === null || !rush.has(row.thread_root_id),
    );
    return {
      messages: oldestFirst(rows.map(toMessage)),
      // The count is of the whole stretch; what was withheld here comes off.
      total: (count ?? fetched.length) - (fetched.length - rows.length),
    };
  }

  async locateMessage(input: {
    chapterId: string;
    messageId: string;
  }): Promise<CatchUpMessagePlace | null> {
    const { data, error } = await this.supabase
      .from('chat_messages')
      .select(
        'channel_id, created_at, thread_root_id, chat_channels!chat_messages_channel_id_fkey!inner(chapter_id, type, is_audit_log)',
      )
      .eq('id', input.messageId)
      .eq('chat_channels.chapter_id', input.chapterId)
      .in('chat_channels.type', CHAPTER_CHANNEL_TYPES)
      .eq('chat_channels.is_audit_log', false)
      .eq('is_deleted', false)
      .in('kind', WRITTEN_KINDS)
      .neq('content', '')
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    if (!data) return null;
    const row = data as unknown as CatchUpMessagePlace;
    if (
      row.thread_root_id !== null &&
      (await this.rushRootIds([row.thread_root_id])).size > 0
    ) {
      return null;
    }
    return {
      channel_id: row.channel_id,
      created_at: row.created_at,
      thread_root_id: row.thread_root_id,
    };
  }

  async readThread(input: {
    chapterId: string;
    channelId: string;
    rootId: string;
    limit: number;
  }): Promise<CatchUpStretch | null> {
    // The thread exists when its first message is a timeline row of this
    // channel, whatever that row is: a thread can hang off a card, or off a
    // message deleted since.
    const root = await this.supabase
      .from('chat_messages')
      .select(`${COLUMNS}, kind, is_deleted`)
      .eq('channel_id', input.channelId)
      .eq('chat_channels.chapter_id', input.chapterId)
      .in('chat_channels.type', CHAPTER_CHANNEL_TYPES)
      .eq('chat_channels.is_audit_log', false)
      .eq('id', input.rootId)
      .is('thread_root_id', null)
      .maybeSingle();
    if (root.error) throw new SupabaseQueryError(root.error);
    if (!root.data) return null;
    const first = root.data as Row & { kind: string; is_deleted: boolean };
    // A thread under a recruitment candidate's card is never summarized.
    if (first.kind === 'rush') return null;
    // Read only when it is conversation, by the rule `written` applies.
    const firstRead =
      !first.is_deleted &&
      (WRITTEN_KINDS as readonly string[]).includes(first.kind) &&
      first.content !== '';

    const replies = await this.written(input.chapterId, input.channelId)
      .eq('thread_root_id', input.rootId)
      .order('created_at', { ascending: false })
      // The first message is always read, so the replies get one fewer.
      .limit(Math.max(input.limit - 1, 0));
    if (replies.error) throw new SupabaseQueryError(replies.error);
    const rows = (replies.data ?? []) as Row[];
    return {
      messages: [
        ...(firstRead ? [toMessage(first)] : []),
        ...oldestFirst(rows.map(toMessage)),
      ],
      total: (firstRead ? 1 : 0) + (replies.count ?? rows.length),
    };
  }
}
