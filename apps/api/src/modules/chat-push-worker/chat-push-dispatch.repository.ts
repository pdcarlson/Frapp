import { Inject, Injectable, Logger } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';
import type {
  FrappSupabaseClient,
  TablesInsert,
} from '../../infrastructure/supabase/database.types';
import {
  PG_FOREIGN_KEY_VIOLATION,
  PG_UNIQUE_VIOLATION,
} from '#domain/constants/postgres-error-codes';
import { logThrowable } from '../../infrastructure/observability/log-throwable';
import { SupabaseQueryError } from '../../infrastructure/supabase/supabase-query-error';

/**
 * How one claim attempt ended.
 *
 * - `claimed`: this instance inserted the row and owns the message's fan-out.
 * - `taken`: another instance (or an earlier delivery) already owns it.
 * - `gone`: the message was hard-deleted before the claim; nothing to send.
 * - `failed`: the insert failed for another reason, already logged.
 */
export type ChatPushClaimOutcome = 'claimed' | 'taken' | 'gone' | 'failed';

/**
 * The push worker's cross-instance claim (#2846). Every API instance receives
 * every `chat_messages` INSERT from Realtime; the primary key on
 * `chat_push_dispatches` is what lets exactly one of them send.
 */
@Injectable()
export class ChatPushDispatchRepository {
  private readonly logger = new Logger(ChatPushDispatchRepository.name);

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: FrappSupabaseClient,
  ) {}

  /**
   * Claim the right to fan out one message.
   *
   * Only `claimed` may send. A `failed` insert is treated as not claimed, the
   * same as `ScheduledJobsRepository.claimDispatch`: on a write whose outcome
   * is unknown, a missed push is the cheaper mistake than one sent twice.
   */
  async claim(messageId: string): Promise<ChatPushClaimOutcome> {
    const row: TablesInsert<'chat_push_dispatches'> = { message_id: messageId };
    const { error } = await this.supabase
      .from('chat_push_dispatches')
      .insert(row);

    if (!error) return 'claimed';
    if (error.code === PG_UNIQUE_VIOLATION) return 'taken';
    if (error.code === PG_FOREIGN_KEY_VIOLATION) return 'gone';

    logThrowable(
      this.logger,
      'error',
      `chat-push: dispatch claim failed for message ${messageId}; its pushes are skipped`,
      error,
    );
    return 'failed';
  }

  /**
   * Delete claims made before `cutoff`, returning how many went.
   *
   * A claim only has to outlive Realtime's redelivery of the same INSERT to
   * another instance, which is seconds. Throws on a failed delete; the caller
   * logs it and the next tick retries.
   */
  async purgeBefore(cutoff: Date): Promise<number> {
    // A count, not the deleted rows: an hour of chat can be thousands of
    // claims, and nothing needs their ids.
    const { count, error } = await this.supabase
      .from('chat_push_dispatches')
      .delete({ count: 'exact' })
      .lt('dispatched_at', cutoff.toISOString());
    if (error) throw new SupabaseQueryError(error);
    return count ?? 0;
  }
}
