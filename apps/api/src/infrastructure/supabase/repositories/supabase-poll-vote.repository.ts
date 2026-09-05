import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import { fetchAllPages } from '../supabase.utils';
import type { FrappSupabaseClient, TablesInsert } from '../database.types';
import type {
  IPollVoteRepository,
  PollUserVoteRow,
  PollVoteOptionTotalRow,
} from '../../../domain/repositories/poll-vote.repository.interface';
import type { PollVote } from '../../../domain/entities/poll-vote.entity';

/**
 * PostgREST default `max-rows` is often 1000; page through to avoid silent
 * truncation.
 *
 * A request size, not an assumption about the server's cap. This value sits
 * exactly at the common default, which is what made the old loop here fail on
 * the *first* page (#1628): it stopped on any short page, so a cap at or below
 * 1000 ended the read early and under-counted vote aggregates. The shared
 * `fetchAllPages` stops only on an empty page and advances by the rows
 * actually returned, so the value is now a throughput choice rather than a
 * correctness one.
 */
const POLL_VOTES_PAGE_SIZE = 1000;

@Injectable()
export class SupabasePollVoteRepository implements IPollVoteRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async findByMessage(messageId: string): Promise<PollVote[]> {
    return this.findByMessages([messageId]);
  }

  async findByMessages(messageIds: string[]): Promise<PollVote[]> {
    if (messageIds.length === 0) {
      return [];
    }
    return fetchAllPages<PollVote>(
      (from, to) =>
        this.supabase
          .from('poll_votes')
          .select('*')
          .in('message_id', messageIds)
          .order('id', { ascending: true })
          .range(from, to),
      { pageSize: POLL_VOTES_PAGE_SIZE },
    );
  }

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
