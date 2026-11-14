import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type {
  FrappSupabaseClient,
  TablesInsert,
  TablesUpdate,
} from '../database.types';
import type {
  ChatScheduledMessagePatch,
  IChatScheduledMessageRepository,
  NewChatScheduledMessage,
} from '#domain/repositories/chat-scheduled-message.repository.interface';
import type {
  ChatScheduledMessage,
  ChatScheduledMessageFailure,
} from '#domain/entities/chat-scheduled-message.entity';
import { SupabaseQueryError } from '../supabase-query-error';

const TABLE = 'chat_scheduled_messages';
/** The tail `chatPreviewPathFor` gives every photo's preview copy. */
const PREVIEW_SUFFIX = '/preview/preview.jpg';

/**
 * Scheduled chat messages (#4956). The table has RLS on and no policies; the
 * API reaches it with the service-role client, and every author-facing query
 * filters on `chapter_id` and `user_id`.
 */
@Injectable()
export class SupabaseChatScheduledMessageRepository implements IChatScheduledMessageRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async listForAuthor(
    chapterId: string,
    userId: string,
    channelId?: string,
  ): Promise<ChatScheduledMessage[]> {
    let query = this.supabase
      .from(TABLE)
      .select('*')
      .eq('chapter_id', chapterId)
      .eq('user_id', userId);
    if (channelId) query = query.eq('channel_id', channelId);
    const { data, error } = await query.order('send_at', { ascending: true });
    if (error) throw new SupabaseQueryError(error);
    return data ?? [];
  }

  async findForAuthor(
    chapterId: string,
    userId: string,
    id: string,
  ): Promise<ChatScheduledMessage | null> {
    const { data, error } = await this.supabase
      .from(TABLE)
      .select('*')
      .eq('chapter_id', chapterId)
      .eq('user_id', userId)
      .eq('id', id)
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async create(row: NewChatScheduledMessage): Promise<ChatScheduledMessage> {
    const insert: TablesInsert<'chat_scheduled_messages'> = { ...row };
    const { data, error } = await this.supabase
      .from(TABLE)
      .insert(insert)
      .select('*')
      .single();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async updateForAuthor(
    chapterId: string,
    userId: string,
    id: string,
    patch: ChatScheduledMessagePatch,
    now: string,
  ): Promise<ChatScheduledMessage | null> {
    // An edit starts the row over: pending, no failure, a fresh set of tries.
    const update: TablesUpdate<'chat_scheduled_messages'> = {
      ...patch,
      status: 'pending',
      failure_reason: null,
      attempts: 0,
      lease_until: null,
      updated_at: now,
    };
    const { data, error } = await this.supabase
      .from(TABLE)
      .update(update)
      .eq('chapter_id', chapterId)
      .eq('user_id', userId)
      .eq('id', id)
      .or(`lease_until.is.null,lease_until.lt."${now}"`)
      .select('*')
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async countPending(chapterId: string, userId: string): Promise<number> {
    const { count, error } = await this.supabase
      .from(TABLE)
      .select('id', { count: 'exact', head: true })
      .eq('chapter_id', chapterId)
      .eq('user_id', userId)
      .eq('status', 'pending');
    if (error) throw new SupabaseQueryError(error);
    return count ?? 0;
  }

  async deleteForAuthor(
    chapterId: string,
    userId: string,
    id: string,
    now: string,
  ): Promise<
    | { outcome: 'deleted'; row: ChatScheduledMessage }
    | { outcome: 'held' }
    | { outcome: 'missing' }
  > {
    const { data, error } = await this.supabase
      .from(TABLE)
      .delete()
      .eq('chapter_id', chapterId)
      .eq('user_id', userId)
      .eq('id', id)
      .or(`lease_until.is.null,lease_until.lt."${now}"`)
      .select('*');
    if (error) throw new SupabaseQueryError(error);
    const [row] = data ?? [];
    if (row) return { outcome: 'deleted', row };
    // Nothing deleted: either no such row, or a send holds it.
    return (await this.findForAuthor(chapterId, userId, id))
      ? { outcome: 'held' }
      : { outcome: 'missing' };
  }

  async findPathsInUse(
    chapterId: string,
    paths: readonly string[],
    excludingId: string | null,
  ): Promise<string[]> {
    // One containment probe per path and field: `contains` sends the value as
    // JSON, so a path with quotes or commas can't break a list syntax and be
    // read as unused (the reason `findSharedObjects` probes one by one). A
    // path that looks like a preview is also asked as a preview.
    const inUse: string[] = [];
    for (const path of new Set(paths)) {
      const fields = path.endsWith(PREVIEW_SUFFIX)
        ? ['storage_path', 'preview_storage_path']
        : ['storage_path'];
      for (const field of fields) {
        let query = this.supabase
          .from(TABLE)
          .select('id')
          .eq('chapter_id', chapterId)
          .contains('attachments', JSON.stringify([{ [field]: path }]));
        if (excludingId) query = query.neq('id', excludingId);
        const { data, error } = await query.limit(1);
        if (error) throw new SupabaseQueryError(error);
        if ((data ?? []).length > 0) {
          inUse.push(path);
          break;
        }
      }
    }
    return inUse;
  }

  async findDue(now: string, limit: number): Promise<ChatScheduledMessage[]> {
    const { data, error } = await this.supabase
      .from(TABLE)
      .select('*')
      .eq('status', 'pending')
      .lte('send_at', now)
      .or(`lease_until.is.null,lease_until.lt."${now}"`)
      .order('send_at', { ascending: true })
      .limit(limit);
    if (error) throw new SupabaseQueryError(error);
    return data ?? [];
  }

  async claim(
    row: Pick<ChatScheduledMessage, 'id' | 'chapter_id' | 'attempts'>,
    leaseUntil: string,
    now: string,
    dueBy?: string,
  ): Promise<ChatScheduledMessage | null> {
    const update: TablesUpdate<'chat_scheduled_messages'> = {
      attempts: row.attempts + 1,
      lease_until: leaseUntil,
      updated_at: now,
    };
    let query = this.supabase
      .from(TABLE)
      .update(update)
      .eq('chapter_id', row.chapter_id)
      .eq('id', row.id)
      .eq('status', 'pending')
      .eq('attempts', row.attempts)
      .or(`lease_until.is.null,lease_until.lt."${now}"`);
    if (dueBy) query = query.lte('send_at', dueBy);
    const { data, error } = await query.select('*').maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async removeSent(
    row: Pick<ChatScheduledMessage, 'id' | 'chapter_id'>,
  ): Promise<void> {
    const { error } = await this.supabase
      .from(TABLE)
      .delete()
      .eq('chapter_id', row.chapter_id)
      .eq('id', row.id);
    if (error) throw new SupabaseQueryError(error);
  }

  async markFailed(
    row: Pick<ChatScheduledMessage, 'id' | 'chapter_id'>,
    reason: ChatScheduledMessageFailure,
  ): Promise<void> {
    const update: TablesUpdate<'chat_scheduled_messages'> = {
      status: 'failed',
      failure_reason: reason,
      lease_until: null,
      updated_at: new Date().toISOString(),
    };
    const { error } = await this.supabase
      .from(TABLE)
      .update(update)
      .eq('chapter_id', row.chapter_id)
      .eq('id', row.id);
    if (error) throw new SupabaseQueryError(error);
  }
}
