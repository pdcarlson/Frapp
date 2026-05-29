import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { CHAT_MESSAGE_REPOSITORY } from '../../domain/repositories/chat.repository.interface';
import type { IChatMessageRepository } from '../../domain/repositories/chat.repository.interface';
import { POLL_VOTE_REPOSITORY } from '../../domain/repositories/poll-vote.repository.interface';
import type { IPollVoteRepository } from '../../domain/repositories/poll-vote.repository.interface';
import type { ChatMessage } from '../../domain/entities/chat.entity';
import type { PollMetadata } from '../../domain/entities/poll-vote.entity';
import { ChannelAccessService } from './channel-access.service';
import {
  LIST_QUERY_LIMIT_DEFAULT,
  LIST_QUERY_LIMIT_MAX,
  LIST_QUERY_LIMIT_MIN,
} from '../../domain/constants/list-query-limits';

const MIN_OPTIONS = 2;
const MAX_OPTIONS = 10;

export interface CreatePollInput {
  channelId: string;
  chapterId: string;
  senderId: string;
  question: string;
  options: string[];
  expiresAt?: string | null;
  choiceMode?: 'single' | 'multi';
}

export interface PollWithResults {
  id: string;
  channel_id: string;
  sender_id: string;
  content: string;
  type: 'POLL';
  metadata: PollMetadata;
  created_at: string;
  isExpired: boolean;
  results: { optionIndex: number; optionText: string; voteCount: number }[];
  userVotes?: number[];
}

@Injectable()
export class PollService {
  private readonly logger = new Logger(PollService.name);

  constructor(
    @Inject(CHAT_MESSAGE_REPOSITORY)
    private readonly messageRepo: IChatMessageRepository,
    @Inject(POLL_VOTE_REPOSITORY)
    private readonly voteRepo: IPollVoteRepository,
    private readonly channelAccess: ChannelAccessService,
  ) {}

  async createPoll(input: CreatePollInput): Promise<ChatMessage> {
    // Posting a poll inserts a chat_messages row, so it must clear the same
    // channel-access + read-only gate as any other send (POLLS_CREATE alone is
    // not enough — it does not imply membership of a private/role-gated channel).
    await this.channelAccess.assertAccess(
      input.channelId,
      input.chapterId,
      input.senderId,
      'post',
    );

    if (
      input.options.length < MIN_OPTIONS ||
      input.options.length > MAX_OPTIONS
    ) {
      throw new BadRequestException(
        `Poll must have between ${MIN_OPTIONS} and ${MAX_OPTIONS} options`,
      );
    }

    const metadata: PollMetadata = {
      question: input.question,
      options: input.options,
      expires_at: input.expiresAt ?? undefined,
      choice_mode: input.choiceMode ?? 'single',
    };

    return this.messageRepo.create({
      channel_id: input.channelId,
      sender_id: input.senderId,
      content: input.question,
      type: 'POLL',
      metadata,
    });
  }

  async vote(
    messageId: string,
    userId: string,
    chapterId: string,
    optionIndexes: number[],
  ): Promise<void> {
    const message = await this.messageRepo.findById(messageId);
    if (!message) {
      throw new NotFoundException('Poll not found');
    }
    if (message.type !== 'POLL') {
      throw new BadRequestException('Message is not a poll');
    }

    // Must be able to see the channel the poll lives in (private/role-gated/DM
    // membership). `read` — voting is participation, not a message post.
    await this.channelAccess.assertAccess(
      message.channel_id,
      chapterId,
      userId,
      'read',
    );

    const metadata = message.metadata as PollMetadata;
    const isExpired = this.isPollExpired(metadata);
    if (isExpired) {
      throw new BadRequestException('Poll has expired');
    }

    const options = metadata.options ?? [];
    for (const idx of optionIndexes) {
      if (idx < 0 || idx >= options.length) {
        throw new BadRequestException(`Invalid option index: ${idx}`);
      }
    }

    if (metadata.choice_mode === 'single') {
      if (optionIndexes.length !== 1) {
        throw new BadRequestException(
          'Single-choice poll requires exactly one option',
        );
      }
      await this.voteRepo.deleteByMessageAndUser(messageId, userId);
      await this.voteRepo.create({
        message_id: messageId,
        user_id: userId,
        option_index: optionIndexes[0],
      });
    } else {
      await this.voteRepo.deleteByMessageAndUser(messageId, userId);
      if (optionIndexes.length === 0) {
        return;
      }

      await this.voteRepo.createMany(
        optionIndexes.map((idx) => ({
          message_id: messageId,
          user_id: userId,
          option_index: idx,
        })),
      );
    }
  }

  async removeVote(
    messageId: string,
    userId: string,
    chapterId: string,
  ): Promise<void> {
    const message = await this.messageRepo.findById(messageId);
    if (!message) {
      throw new NotFoundException('Poll not found');
    }
    if (message.type !== 'POLL') {
      throw new BadRequestException('Message is not a poll');
    }

    await this.channelAccess.assertAccess(
      message.channel_id,
      chapterId,
      userId,
      'read',
    );

    const metadata = message.metadata as PollMetadata;
    if (this.isPollExpired(metadata)) {
      throw new BadRequestException('Poll has expired');
    }

    await this.voteRepo.deleteByMessageAndUser(messageId, userId);
  }

  async getPoll(
    messageId: string,
    chapterId: string,
    userId: string,
  ): Promise<PollWithResults> {
    const message = await this.messageRepo.findById(messageId);
    if (!message) {
      throw new NotFoundException('Poll not found');
    }
    if (message.type !== 'POLL') {
      throw new BadRequestException('Message is not a poll');
    }

    // Reading a poll's question/options/tallies requires being able to read the
    // channel it lives in — otherwise private/role-gated poll content leaks.
    await this.channelAccess.assertAccess(
      message.channel_id,
      chapterId,
      userId,
      'read',
    );

    const metadata = message.metadata as PollMetadata;
    const options = metadata.options ?? [];
    const votes = await this.voteRepo.findByMessage(messageId);

    const results = options.map((optionText, optionIndex) => ({
      optionIndex,
      optionText,
      voteCount: votes.filter((v) => v.option_index === optionIndex).length,
    }));

    const userVoteList = await this.voteRepo.findByMessageAndUser(
      messageId,
      userId,
    );
    const userVotes = userVoteList.map((v) => v.option_index);

    return {
      id: message.id,
      channel_id: message.channel_id,
      sender_id: message.sender_id,
      content: message.content,
      type: 'POLL',
      metadata,
      created_at: message.created_at,
      isExpired: this.isPollExpired(metadata),
      results,
      userVotes,
    };
  }

  private isPollExpired(metadata: PollMetadata): boolean {
    const expiresAt = metadata.expires_at;
    if (!expiresAt) return false;
    return new Date(expiresAt) <= new Date();
  }

  /**
   * Drop polls whose channel the caller cannot read. Resolves access once for
   * the whole page (membership + permissions loaded a single time), so this
   * adds at most a couple of queries regardless of poll count. A missing
   * `userId` means there is no principal to authorize against → empty list.
   */
  private async filterPollsByChannelAccess(
    chapterId: string,
    userId: string | undefined,
    messages: ChatMessage[],
  ): Promise<ChatMessage[]> {
    if (messages.length === 0) return messages;
    if (!userId) return [];

    const accessibleChannelIds =
      await this.channelAccess.filterAccessibleChannelIds(
        chapterId,
        userId,
        messages.map((message) => message.channel_id),
        'read',
      );

    return messages.filter((message) =>
      accessibleChannelIds.has(message.channel_id),
    );
  }

  /**
   * Chapter-wide poll list for the admin Polls surface. Filters by channel
   * and/or active/expired state, and includes vote tallies so the list can
   * show aggregate results inline. `userId` opts the caller into
   * `userVotes` so members see their own selections highlighted.
   */
  async listPolls(
    chapterId: string,
    options: {
      channelId?: string;
      active?: boolean;
      limit?: number;
      userId?: string;
    } = {},
  ): Promise<PollWithResults[]> {
    const limit = Math.max(
      LIST_QUERY_LIMIT_MIN,
      Math.min(options.limit ?? LIST_QUERY_LIMIT_DEFAULT, LIST_QUERY_LIMIT_MAX),
    );

    const messages = await this.messageRepo.findPollsByChapter(chapterId, {
      channelId: options.channelId,
      limit,
      active: options.active,
    });

    // Channel-access filter (same predicate as the per-poll endpoints): a poll
    // in a channel the caller cannot read must not surface here — nor may its
    // tallies be assembled below. Without a principal we cannot authorize, so
    // we return nothing (fail closed). The controller always supplies userId.
    const visibleMessages = await this.filterPollsByChannelAccess(
      chapterId,
      options.userId,
      messages,
    );
    if (visibleMessages.length === 0) return [];

    const listRows: {
      message: ChatMessage;
      metadata: PollMetadata;
      expired: boolean;
    }[] = [];
    for (const message of visibleMessages) {
      const metadata = message.metadata as PollMetadata;
      const expired = this.isPollExpired(metadata);
      // Active/expired scoping is applied in `findPollsByChapter` before `limit`.
      // Do not re-filter here: a second `new Date()` can disagree with the query
      // instant and shrink the page below `limit`.
      listRows.push({ message, metadata, expired });
    }

    const messageIds = listRows.map((row) => row.message.id);
    const voteCountsByMessageId = new Map<string, Map<number, number>>();
    let userVotesByMessageId: Map<string, number[]> | null = null;

    try {
      const totals =
        await this.voteRepo.aggregateOptionTotalsByMessages(messageIds);
      for (const row of totals) {
        let byOption = voteCountsByMessageId.get(row.message_id);
        if (!byOption) {
          byOption = new Map<number, number>();
          voteCountsByMessageId.set(row.message_id, byOption);
        }
        byOption.set(row.option_index, row.vote_count);
      }
    } catch (error) {
      // Failed aggregate read: return polls with zero vote tallies rather than failing the list.
      this.logger.error(
        `Batch poll vote totals RPC failed for chapter ${chapterId} (${messageIds.length} polls); vote tallies omitted`,
        error instanceof Error ? error.stack : String(error),
      );
    }

    if (options.userId) {
      userVotesByMessageId = new Map<string, number[]>();
      try {
        const userRows = await this.voteRepo.findUserVotesByMessagesForUser(
          messageIds,
          options.userId,
        );
        for (const row of userRows) {
          let userList = userVotesByMessageId.get(row.message_id);
          if (!userList) {
            userList = [];
            userVotesByMessageId.set(row.message_id, userList);
          }
          userList.push(row.option_index);
        }
      } catch (error) {
        this.logger.error(
          `Batch poll user-vote RPC failed for chapter ${chapterId} (user ${options.userId}); userVotes omitted`,
          error instanceof Error ? error.stack : String(error),
        );
        userVotesByMessageId = new Map();
      }
    }

    const results: PollWithResults[] = [];
    for (const { message, metadata, expired } of listRows) {
      const countsByOption = voteCountsByMessageId.get(message.id);
      const options_ = metadata.options ?? [];
      const entry: PollWithResults = {
        id: message.id,
        channel_id: message.channel_id,
        sender_id: message.sender_id,
        content: message.content,
        type: 'POLL',
        metadata,
        created_at: message.created_at,
        isExpired: expired,
        results: options_.map((optionText, optionIndex) => ({
          optionIndex,
          optionText,
          voteCount: countsByOption?.get(optionIndex) ?? 0,
        })),
      };
      if (userVotesByMessageId) {
        entry.userVotes = userVotesByMessageId.get(message.id) ?? [];
      }
      results.push(entry);
    }

    return results;
  }
}
