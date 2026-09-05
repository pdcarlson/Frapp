import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient, TablesInsert } from '../database.types';
import type {
  IPollVoteRepository,
  PollUserVoteRow,
  PollVoteOptionTotalRow,
} from '../../../domain/repositories/poll-vote.repository.interface';
import type { PollVote } from '../../../domain/entities/poll-vote.entity';

/**
 * No method here reads whole `poll_votes` rows to count them. Both callers that
 * did — `PollService.listPolls`, then `getPoll` (#568) — now tally through the
 * `GROUP BY` RPCs below, so the paged row read and its 1000-row page size
 * (#1628) were deleted rather than left as a faster-looking alternative.
 *
 * That trade is only safe *per poll*. These RPCs emit one row per (poll,
 * option), and an RPC result set is subject to `max_rows` exactly like a table
 * read (`report.service.ts` says the same of `get_points_report`), so a
 * 200-poll `listPolls` page can still overrun the 1000-row cap and truncate
 * silently — **#1756**, which pages them. `getPoll` passes a single message id
 * and reads at most `options.length` rows, so it is structurally clear of that.
 */
@Injectable()
export class SupabasePollVoteRepository implements IPollVoteRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async aggregateOptionTotalsByMessages(
    messageIds: string[],
  ): Promise<PollVoteOptionTotalRow[]> {
    if (messageIds.length === 0) {
      return [];
    }
    const { data, error } = await this.supabase.rpc(
      'get_poll_vote_option_totals',
      { p_message_ids: messageIds },
    );
    if (error) throw error;
    return (data ?? []).map((row) => ({
      message_id: row.message_id,
      option_index: row.option_index,
      vote_count: Number(row.vote_count),
    }));
  }

  async findUserVotesByMessagesForUser(
    messageIds: string[],
    userId: string,
  ): Promise<PollUserVoteRow[]> {
    if (messageIds.length === 0) {
      return [];
    }
    const { data, error } = await this.supabase.rpc(
      'get_poll_user_votes_for_messages',
      { p_message_ids: messageIds, p_user_id: userId },
    );
    if (error) throw error;
    return data ?? [];
  }

  async findByMessageAndUser(
    messageId: string,
    userId: string,
  ): Promise<PollVote[]> {
    const { data, error } = await this.supabase
      .from('poll_votes')
      .select('*')
      .eq('message_id', messageId)
      .eq('user_id', userId);
    if (error) throw error;
    return data || [];
  }

  async create(data: TablesInsert<'poll_votes'>): Promise<PollVote> {
    const { data: created, error } = await this.supabase
      .from('poll_votes')
      .insert(data)
      .select()
      .single();
    if (error) throw error;
    return created;
  }

  async createMany(data: TablesInsert<'poll_votes'>[]): Promise<PollVote[]> {
    if (data.length === 0) {
      return [];
    }

    const { data: created, error } = await this.supabase
      .from('poll_votes')
      .insert(data)
      .select();
    if (error) throw error;
    return created || [];
  }

  async deleteByMessageAndUser(
    messageId: string,
    userId: string,
  ): Promise<void> {
    const { error } = await this.supabase
      .from('poll_votes')
      .delete()
      .eq('message_id', messageId)
      .eq('user_id', userId);
    if (error) throw error;
  }

  async deleteByMessageUserAndOption(
    messageId: string,
    userId: string,
    optionIndex: number,
  ): Promise<void> {
    const { error } = await this.supabase
      .from('poll_votes')
      .delete()
      .eq('message_id', messageId)
      .eq('user_id', userId)
      .eq('option_index', optionIndex);
    if (error) throw error;
  }
}
