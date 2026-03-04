import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient } from '../database.types';
import type { IPollVoteRepository } from '../../../domain/repositories/poll-vote.repository.interface';
import type { PollVote } from '../../../domain/entities/poll-vote.entity';

@Injectable()
export class SupabasePollVoteRepository implements IPollVoteRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async findByMessage(messageId: string): Promise<PollVote[]> {
    const { data, error } = await this.supabase
      .from('poll_votes')
      .select('*')
      .eq('message_id', messageId);
    if (error) throw error;
    return (data as PollVote[]) || [];
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
      .insert(data)
      .select()
      .single();
    if (error) throw error;
    return created as PollVote;
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
