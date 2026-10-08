import { Inject, Injectable, Logger } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient, TablesInsert } from '../database.types';
import {
  PG_FOREIGN_KEY_VIOLATION,
  PG_UNIQUE_VIOLATION,
} from '#domain/constants/postgres-error-codes';
import { logThrowable } from '../../observability/log-throwable';
import { SupabaseQueryError } from '../supabase-query-error';
import type {
  ChatPushClaimOutcome,
  IChatPushDispatchRepository,
} from '#domain/repositories/chat-push-dispatch.repository.interface';

/**
 * The push worker's cross-instance claim (#2846); the contract is on
 * {@link IChatPushDispatchRepository}.
 */
@Injectable()
export class SupabaseChatPushDispatchRepository implements IChatPushDispatchRepository {
  private readonly logger = new Logger(SupabaseChatPushDispatchRepository.name);

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: FrappSupabaseClient,
  ) {}

  /**
   * Claim the right to fan out one message.
   *
   * Only `claimed` may send. A `failed` insert is treated as not claimed, the
   * same as `SupabaseScheduledJobsRepository.claimDispatch`: on a write whose outcome
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
