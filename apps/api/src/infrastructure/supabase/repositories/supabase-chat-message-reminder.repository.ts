import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient, TablesInsert } from '../database.types';
import type {
  ChatMessageReminder,
  IChatMessageReminderRepository,
  StoredChatMessageReminder,
} from '#domain/repositories/chat-message-reminder.repository.interface';
import { SupabaseQueryError } from '../supabase-query-error';
import { BOOKMARK_MESSAGE_COLUMNS } from './supabase-chat-message-bookmark.repository';

const REMINDER_COLUMNS =
  'id, user_id, message_id, chapter_id, remind_at, fired_at, created_at, updated_at';

/**
 * The message is embedded with a bookmark's narrow columns: a reminder row
 * draws the same author, time and preview, and opens the same way.
 */
const REMINDER_WITH_MESSAGE_SELECT = `${REMINDER_COLUMNS}, message:chat_messages!inner(${BOOKMARK_MESSAGE_COLUMNS})`;

/**
 * Private reminders on chat messages (#4957). Every member-facing query is
 * scoped to the caller's `user_id` and chapter; the table has RLS on with no
 * policies, so this service-role client is the only way in.
 */
@Injectable()
export class SupabaseChatMessageReminderRepository implements IChatMessageReminderRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async upsert(
    userId: string,
    messageId: string,
    chapterId: string,
    remindAt: string,
  ): Promise<ChatMessageReminder> {
    const payload: TablesInsert<'chat_message_reminders'> = {
      user_id: userId,
      message_id: messageId,
      chapter_id: chapterId,
      remind_at: remindAt,
      // A new time is a new reminder: one already sent fires again.
      fired_at: null,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await this.supabase
      .from('chat_message_reminders')
      .upsert(payload, {
        onConflict: 'user_id,message_id',
        ignoreDuplicates: false,
      })
      .select(REMINDER_COLUMNS)
      .single();
    if (error) throw new SupabaseQueryError(error);
    return data as ChatMessageReminder;
  }

  /**
   * Scoped by chapter as well as the globally unique (user, message) pair,
   * as the bookmark delete is: a caller that skipped its own checks still
   * could not reach across chapters.
   */
  async delete(
    userId: string,
    messageId: string,
    chapterId: string,
  ): Promise<void> {
    const { error } = await this.supabase
      .from('chat_message_reminders')
      .delete()
      .eq('user_id', userId)
      .eq('message_id', messageId)
      .eq('chapter_id', chapterId);
    if (error) throw new SupabaseQueryError(error);
  }

  async findByUserAndChapter(
    userId: string,
    chapterId: string,
    limit: number,
  ): Promise<StoredChatMessageReminder[]> {
    const { data, error } = await this.supabase
      .from('chat_message_reminders')
      .select(REMINDER_WITH_MESSAGE_SELECT)
      .eq('user_id', userId)
      .eq('chapter_id', chapterId)
      .order('remind_at', { ascending: true })
      .limit(limit);
    if (error) throw new SupabaseQueryError(error);
    // PostgREST types an embed as `T | GenericStringError`, which it is only
    // when `error` is set, thrown above.
    return (data ?? []) as unknown as StoredChatMessageReminder[];
  }

  async findDue(
    now: string,
    limit: number,
  ): Promise<StoredChatMessageReminder[]> {
    const { data, error } = await this.supabase
      .from('chat_message_reminders')
      .select(REMINDER_WITH_MESSAGE_SELECT)
      .is('fired_at', null)
      .lte('remind_at', now)
      .order('remind_at', { ascending: true })
      .limit(limit);
    if (error) throw new SupabaseQueryError(error);
    return (data ?? []) as unknown as StoredChatMessageReminder[];
  }

  async claimDue(
    reminder: Pick<ChatMessageReminder, 'id' | 'remind_at'>,
    firedAt: string,
  ): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('chat_message_reminders')
      .update({ fired_at: firedAt })
      .eq('id', reminder.id)
      .eq('remind_at', reminder.remind_at)
      .is('fired_at', null)
      .select('id');
    if (error) throw new SupabaseQueryError(error);
    return (data ?? []).length > 0;
  }
}
