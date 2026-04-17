import type { PollVote } from '../entities/poll-vote.entity';

export const POLL_VOTE_REPOSITORY = 'POLL_VOTE_REPOSITORY';

/** Per-option vote counts for a batch of poll messages (DB-aggregated). */
export interface PollVoteOptionTotalRow {
  message_id: string;
  option_index: number;
  vote_count: number;
}

/** A user's vote selections across a batch of poll messages. */
export interface PollUserVoteRow {
  message_id: string;
  option_index: number;
}

export interface IPollVoteRepository {
  findByMessage(messageId: string): Promise<PollVote[]>;
  /** All votes for any of the given poll message ids (one round-trip). */
  findByMessages(messageIds: string[]): Promise<PollVote[]>;
  /**
   * `GROUP BY message_id, option_index` totals for the given poll message ids.
   * Empty when `messageIds` is empty.
   */
  aggregateOptionTotalsByMessages(
    messageIds: string[],
  ): Promise<PollVoteOptionTotalRow[]>;
  /**
   * All option indices the user voted for, across the given poll message ids.
   * Empty when `messageIds` is empty.
   */
  findUserVotesByMessagesForUser(
    messageIds: string[],
    userId: string,
  ): Promise<PollUserVoteRow[]>;
  findByMessageAndUser(messageId: string, userId: string): Promise<PollVote[]>;
  create(data: Partial<PollVote>): Promise<PollVote>;
  createMany(data: Partial<PollVote>[]): Promise<PollVote[]>;
  deleteByMessageAndUser(messageId: string, userId: string): Promise<void>;
  deleteByMessageUserAndOption(
    messageId: string,
    userId: string,
    optionIndex: number,
  ): Promise<void>;
}
