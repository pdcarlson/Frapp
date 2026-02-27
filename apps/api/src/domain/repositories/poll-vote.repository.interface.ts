import type { PollVote } from '../entities/poll-vote.entity';

export const POLL_VOTE_REPOSITORY = 'POLL_VOTE_REPOSITORY';

export interface IPollVoteRepository {
  findByMessage(messageId: string): Promise<PollVote[]>;
  findByMessageAndUser(
    messageId: string,
    userId: string,
  ): Promise<PollVote[]>;
  create(data: Partial<PollVote>): Promise<PollVote>;
  deleteByMessageAndUser(messageId: string, userId: string): Promise<void>;
  deleteByMessageUserAndOption(
    messageId: string,
    userId: string,
    optionIndex: number,
  ): Promise<void>;
}
