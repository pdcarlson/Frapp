import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient } from '../database.types';
import type { IPollVoteRepository } from '../../../domain/repositories/poll-vote.repository.interface';
import type { PollVote } from '../../../domain/entities/poll-vote.entity';

/** PostgREST default `max-rows` is often 1000; page through to avoid silent truncation. */
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
    const all: PollVote[] = [];
    for (let from = 0; ; from += POLL_VOTES_PAGE_SIZE) {
      const to = from + POLL_VOTES_PAGE_SIZE - 1;
      const { data, error } = await this.supabase
        .from('poll_votes')
        .select('*')
        .in('message_id', messageIds)
        .range(from, to);
      if (error) throw error;
      const page = (data as PollVote[]) || [];
      all.push(...page);
      if (page.length < POLL_VOTES_PAGE_SIZE) {
        break;
      }
    }
    return all;
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
    return (data as PollVote[]) || [];
  }

  async create(data: Partial<PollVote>): Promise<PollVote> {
    const { data: created, error } = await this.supabase
      .from('poll_votes')
      .insert(data as never)
      .select()
      .single();
    if (error) throw error;
    return created as PollVote;
  }

  async createMany(data: Partial<PollVote>[]): Promise<PollVote[]> {
    if (data.length === 0) {
      return [];
    }

    const { data: created, error } = await this.supabase
      .from('poll_votes')
      .insert(data as never)
      .select();
    if (error) throw error;
    return (created as PollVote[]) || [];
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
