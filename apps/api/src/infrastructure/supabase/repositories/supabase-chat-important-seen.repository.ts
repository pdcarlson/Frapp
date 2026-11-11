import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient, TablesInsert } from '../database.types';
import type { IChatImportantSeenRepository } from '#domain/repositories/chat-important.repository.interface';
import { SupabaseQueryError } from '../supabase-query-error';

/**
 * Which Important messages a member has seen (#4186).
 *
 * Every query filters on `chapter_id` and `user_id`. The API reaches the table
 * through the service-role client, which bypasses RLS, and the table enables
 * RLS with no policies, so no client can read it directly: what a member has
 * seen is served only to them, through `ChatImportantService`.
 */
@Injectable()
export class SupabaseChatImportantSeenRepository implements IChatImportantSeenRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async findSeenMessageIds(
    chapterId: string,
    userId: string,
    messageIds: readonly string[],
  ): Promise<Set<string>> {
    if (messageIds.length === 0) return new Set();
    const { data, error } = await this.supabase
      .from('chat_message_important_seen')
      .select('message_id')
      .eq('chapter_id', chapterId)
      .eq('user_id', userId)
      .in('message_id', [...messageIds]);
    if (error) throw new SupabaseQueryError(error);
    return new Set((data ?? []).map((row) => row.message_id));
  }

  /**
   * Idempotent: `ignoreDuplicates` leaves an existing row alone, so the first
   * `seen_at` stands and a retry or a second device is a no-op.
   */
  async markSeen(
    chapterId: string,
    userId: string,
    messageIds: readonly string[],
  ): Promise<void> {
    if (messageIds.length === 0) return;
    const rows: TablesInsert<'chat_message_important_seen'>[] = [
      ...new Set(messageIds),
    ].map((messageId) => ({
      user_id: userId,
      message_id: messageId,
      chapter_id: chapterId,
    }));
    const { error } = await this.supabase
      .from('chat_message_important_seen')
      .upsert(rows, {
        onConflict: 'user_id,message_id',
        ignoreDuplicates: true,
      });
    if (error) throw new SupabaseQueryError(error);
  }
}
