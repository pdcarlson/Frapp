import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { isPollClosed, validateIndexedPollVote } from '@repo/validation';
import { CHAT_MESSAGE_REPOSITORY } from '#domain/repositories/chat.repository.interface';
import type { IChatMessageRepository } from '#domain/repositories/chat.repository.interface';
import { POLL_VOTE_REPOSITORY } from '#domain/repositories/poll-vote.repository.interface';
import type {
  IPollVoteRepository,
  PollVoteOptionTotalRow,
} from '#domain/repositories/poll-vote.repository.interface';
import type { ChatMessage } from '#domain/entities/chat.entity';
import { SYSTEM_SENDER_ID } from '#domain/constants/chat';
import type { PollMetadata } from '#domain/entities/poll-vote.entity';
import { ChannelAccessService } from './channel-access.service';
import { clampListLimit } from '#domain/constants/list-query-limits';

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
  /**
   * Nullable because `chat_messages.sender_id` is. In practice a poll always has
   * one — `poll` is not a kind the archive importer writes, and `createPoll`
   * takes the sender from the session — but the field is projected straight off
   * the message row, so narrowing it here would be a lie the compiler could not
   * catch at the seam where it is read.
   */
  sender_id: string | null;
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
    // A poll is a chat message: creating one is a "post" into the channel, so
    // authorize through the shared predicate (PRIVATE / ROLE_GATED / read-only
    // gates all apply) before anything else.
    await this.channelAccess.assertChannelAccess(
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

    // Voting writes into the poll's channel — authorize before revealing
    // anything about the poll (type, expiry, options). "vote" clears the same
    // read-only gate as posting but is exempt from the Alumni lifecycle rule:
    // participating in a poll they can read is not posting.
    await this.channelAccess.assertChannelAccess(
      message.channel_id,
      chapterId,
      userId,
      'vote',
    );

    if (message.type !== 'POLL') {
      throw new BadRequestException('Message is not a poll');
    }

    const metadata = message.metadata as PollMetadata;
    const options = metadata.options ?? [];

    // Same rules the chat-card vote path now applies (#871). The messages below
    // are unchanged so this service's existing tests keep passing untouched —
    // that they do is the proof the extraction preserved behaviour.
    //
    // `validateIndexedPollVote` only knows about one deadline field
    // (`expiresAt`), but this service has two independent "closed" signals —
    // `expires_at` and the manual `closed_at` (#379). Rather than running a
    // second, separate expiry check before this one (redundant, and it would
    // make the switch's `'closed'` case below permanently unreachable), feed
    // it whichever deadline is earlier: `closed_at`, once set, is always a
    // timestamp already in the past (`close()` stamps it with the current
    // time), so passing it in place of `expires_at` makes `isPollClosed`
    // report closed immediately, with the same single check either way.
    const rejection = validateIndexedPollVote({
      expiresAt: metadata.closed_at ?? metadata.expires_at,
      optionCount: options.length,
      optionIndexes,
      choiceMode: metadata.choice_mode,
    });
    if (rejection) {
      switch (rejection.reason) {
        case 'closed':
          throw new BadRequestException('Poll has expired');
        case 'unknown_option':
          throw new BadRequestException(
            `Invalid option index: ${rejection.option}`,
          );
        case 'cardinality':
          throw new BadRequestException(
            'Single-choice poll requires exactly one option',
          );
      }
    }

    if (metadata.choice_mode === 'single') {
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

    // Removing a vote mutates the poll's channel — authorize as a "vote"
    // (same gates as posting, minus the Alumni lifecycle rule) so a vote that
    // was allowed can always be retracted.
    await this.channelAccess.assertChannelAccess(
      message.channel_id,
      chapterId,
      userId,
      'vote',
    );

    if (message.type !== 'POLL') {
      throw new BadRequestException('Message is not a poll');
    }

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

    // Reading a poll exposes its question, options, and tallies — authorize a
    // "read" against the channel before returning any of it.
    await this.channelAccess.assertChannelAccess(
      message.channel_id,
      chapterId,
      userId,
      'read',
    );

    if (message.type !== 'POLL') {
      throw new BadRequestException('Message is not a poll');
    }

    const metadata = message.metadata as PollMetadata;
    const options = metadata.options ?? [];

    // Tally in Postgres, not here: the same `get_poll_vote_option_totals` RPC
    // `listPolls` uses, called with this one message id. Reading every
    // `poll_votes` row back to count them cost O(votes) on the wire and
    // O(options × votes) to scan — a meeting poll in a large chapter is
    // thousands of rows to answer a handful of integers. Unlike `listPolls`,
    // a failed aggregate is NOT swallowed here: a detail view that renders
    // every option at zero is indistinguishable from a real result, so the
    // error propagates as it did when this read rows.
    //
    // The two reads need nothing from each other and both run behind the one
    // channel gate above, so they go concurrently rather than costing this
    // endpoint two serial round trips — a poll posted to a channel opens as a
    // burst of detail views, not one at a time.
    // Both reads take `message.id`, not `messageId`: past this point the route
    // parameter has served its purpose and the database's own id is the one
    // canonical spelling of it.
    const [totals, userVoteList] = await Promise.all([
      this.voteRepo.aggregateOptionTotalsByMessages([message.id]),
      this.voteRepo.findByMessageAndUser(message.id, userId),
    ]);

    // Scoped to this poll before keying on `option_index` alone: the RPC takes
    // a list, and a later caller widening it must not silently fold another
    // poll's tallies into this one. Keyed on `message.id` — the id the database
    // just returned — never on `messageId`, which is whatever the URL said.
    const countsByOption =
      this.groupTotalsByMessage(totals).get(message.id) ??
      new Map<number, number>();

    const results = options.map((optionText, optionIndex) => ({
      optionIndex,
      optionText,
      voteCount: countsByOption.get(optionIndex) ?? 0,
    }));

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

  /**
   * Fan `get_poll_vote_option_totals` rows out into per-poll, per-option counts.
   * Shared by `listPolls` and `getPoll` so the two read paths cannot drift.
   *
   * Keys on the `message_id` the database returned. Callers must look results
   * up by a database-supplied id too (`message.id`, not a route parameter): a
   * `uuid` is 128 bits, so Postgres accepts any case on the way in and always
   * renders it canonically lower-case on the way out. An id taken from a URL
   * therefore matches every row inside the query and can still fail `===`
   * against every row that comes back.
   */
  private groupTotalsByMessage(
    totals: PollVoteOptionTotalRow[],
  ): Map<string, Map<number, number>> {
    const byMessage = new Map<string, Map<number, number>>();
    for (const row of totals) {
      let byOption = byMessage.get(row.message_id);
      if (!byOption) {
        byOption = new Map<number, number>();
        byMessage.set(row.message_id, byOption);
      }
      byOption.set(row.option_index, row.vote_count);
    }
    return byMessage;
  }

  /**
   * A poll is closed by its deadline passing OR the creator manually closing it
   * early (`close`). Thin wrapper so every read/write path shares one notion of
   * "closed" rather than each re-deriving it from the two metadata fields.
   */
  private isPollExpired(metadata: PollMetadata): boolean {
    return !!metadata.closed_at || isPollClosed(metadata.expires_at);
  }

  /**
   * Manual early close (`spec/behavior/polls.md`: "Once expired (or manually
   * closed by the creator), the poll is locked"). Creator-only, enforced by
   * the `sender_id` check below — channel access is authorized as a `vote`
   * (like `vote`/`removeVote`, exempt from the Alumni post restriction) even
   * though `close` isn't a vote, because gating it as a `post` would strand
   * an open-ended (no `expires_at`) poll forever the moment its creator loses
   * post rights in the channel (e.g. transitions to Alumni): `isPollExpired`
   * never trips without a deadline, and nothing else may close it.
   */
  async close(
    messageId: string,
    userId: string,
    chapterId: string,
  ): Promise<ChatMessage> {
    const message = await this.messageRepo.findById(messageId);
    if (!message) {
      throw new NotFoundException('Poll not found');
    }

    await this.channelAccess.assertChannelAccess(
      message.channel_id,
      chapterId,
      userId,
      'vote',
    );

    if (message.type !== 'POLL') {
      throw new BadRequestException('Message is not a poll');
    }

    // Mirrors `editMessage`'s guard (chat.service.ts) — deletion is soft, so
    // the row is still reachable by id, and a close must not resurrect a
    // deleted poll's question/options into `metadata` (deleteMessage wipes
    // `metadata` to `{}`; this method would otherwise spread the pre-delete
    // copy it just read back in below).
    if (message.is_deleted) {
      throw new BadRequestException('Cannot close a deleted poll');
    }

    if (message.sender_id !== userId) {
      throw new ForbiddenException('Only the poll creator can close it');
    }

    const metadata = message.metadata as PollMetadata;
    if (metadata.closed_at) {
      throw new BadRequestException('Poll is already closed');
    }
    if (this.isPollExpired(metadata)) {
      throw new BadRequestException('Poll has expired');
    }

    return this.messageRepo.update(messageId, {
      metadata: {
        ...metadata,
        closed_at: new Date().toISOString(),
        closed_by: userId,
      } satisfies PollMetadata,
    });
  }

  /**
   * Post a `system_audit` notice into the poll's channel announcing that it
   * expired (#404). Uses `messageRepo.create` directly rather than
   * `ChatService.sendMessage` — the same reason `notifyInviterOfAcceptance`
   * and `postWelcomeMessage` bypass it: that path would reject
   * `SYSTEM_SENDER_ID` as a poster. `push-rules.ts` already suppresses push
   * for `system_audit`, so this is visible in the channel without paging
   * anyone — the sweep's caller (`ScheduledJobsService`) is what decides
   * whether this fires at all, once per poll (dispatch claim).
   *
   * Re-checks `closed_at` immediately before posting: the sweep's candidate
   * list is a point-in-time snapshot, and the creator can manually `close()`
   * the same poll in the gap between that snapshot and this call. Without
   * this check a manual close would still get a spurious "has closed" auto
   * notice — and, because the sweep's dispatch claim is already taken by
   * then, one nothing could later correct.
   */
  async announceExpiry(
    pollId: string,
    channelId: string,
    question: string,
  ): Promise<void> {
    const current = await this.messageRepo.findById(pollId);
    const metadata = current?.metadata as PollMetadata | undefined;
    if (metadata?.closed_at) return;

    await this.messageRepo.create({
      channel_id: channelId,
      sender_id: SYSTEM_SENDER_ID,
      content: `Poll "${question}" has closed.`,
      kind: 'system_audit',
    });
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
    const limit = clampListLimit(options.limit);

    const messages = await this.messageRepo.findPollsByChapter(chapterId, {
      channelId: options.channelId,
      limit,
      active: options.active,
    });

    // Channel-access filter: the chapter-wide list must not become a
    // side-channel that leaks polls from PRIVATE / ROLE_GATED / DM channels the
    // caller cannot read (mirrors "search is not a side-channel"). A missing
    // `userId` cannot be authorized, so it sees nothing. Filtering after the
    // repository `limit` can yield fewer than `limit` rows — that is the safe,
    // correct behavior; we never widen the page to backfill hidden polls.
    const accessibleChannelIds =
      await this.channelAccess.filterAccessibleChannelIds(
        chapterId,
        options.userId ?? '',
        messages.map((message) => message.channel_id),
      );
    const visibleMessages = messages.filter((message) =>
      accessibleChannelIds.has(message.channel_id),
    );

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
    let voteCountsByMessageId = new Map<string, Map<number, number>>();
    let userVotesByMessageId: Map<string, number[]> | null = null;

    try {
      const totals =
        await this.voteRepo.aggregateOptionTotalsByMessages(messageIds);
      voteCountsByMessageId = this.groupTotalsByMessage(totals);
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
