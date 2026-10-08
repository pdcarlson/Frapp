import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { validateCardPollVote } from '@repo/validation';
import {
  CHAT_MESSAGE_ACTION_REPOSITORY,
  MESSAGE_REACTION_REPOSITORY,
  ChatMessageActionDuplicateError,
  type IChatMessageActionRepository,
  type IMessageReactionRepository,
} from '#domain/repositories/chat.repository.interface';
import type { ChatMessageAction } from '#domain/entities/chat.entity';
import { ChannelAccessService } from './channel-access.service';
import { assertModuleEnabled, type EnabledModules } from './module-gate';
import { ChatBlockService } from './chat-block.service';
import { isFromBlockedSender } from './chat-block-mask';

/** Vote action UPSERTS rather than duplicates (ADR-07). */
const VOTE_ACTION_TYPE = 'vote';

/** The poll-card payload written by the composer (`@repo/chat-core/dispatch`). */
type PollCardPayload = {
  options?: { id?: unknown }[];
  closes_at?: string | null;
  choice_mode?: 'single' | 'multi';
};

/**
 * Applies the shared poll rules to a chat-card vote, translating a rejection
 * into the same 400 the polls surface returns.
 *
 * A card whose payload carries no options is left alone rather than rejected:
 * that is a malformed message, and refusing every vote on it would turn a data
 * problem into a dead card. Cards default to single-choice, matching the
 * composer, which offers no multi-select.
 */
function assertCardPollVoteAllowed(
  messagePayload: unknown,
  actionPayload: Record<string, unknown>,
): void {
  const card = (messagePayload ?? {}) as PollCardPayload;
  const optionIds = (card.options ?? [])
    .map((option) => option?.id)
    .filter((id): id is string => typeof id === 'string');
  if (optionIds.length === 0) return;

  const rawSelection = actionPayload['option_id'];
  const selected = (
    Array.isArray(rawSelection) ? rawSelection : [rawSelection]
  ).filter((id): id is string => typeof id === 'string');

  const rejection = validateCardPollVote({
    closesAt: card.closes_at,
    optionIds,
    selected,
    choiceMode: card.choice_mode ?? 'single',
  });
  if (!rejection) return;

  switch (rejection.reason) {
    case 'closed':
      throw new BadRequestException('Poll has expired');
    case 'unknown_option':
      throw new BadRequestException(`Invalid option: ${rejection.option}`);
    case 'cardinality':
      throw new BadRequestException(
        'Single-choice poll requires exactly one option',
      );
  }
}

/**
 * A member's responses to a message: emoji reactions on the legacy
 * `message_reactions` table, and the `chat_message_actions` hot path that
 * carries reactions, card-poll votes and RSVPs.
 *
 * Split out of `ChatService` (#1380). It shares only the message-access check
 * and the block list with the send path, and never writes a message.
 */
@Injectable()
export class ChatReactionService {
  constructor(
    @Inject(MESSAGE_REACTION_REPOSITORY)
    private readonly reactionRepo: IMessageReactionRepository,
    @Inject(CHAT_MESSAGE_ACTION_REPOSITORY)
    private readonly actionRepo: IChatMessageActionRepository,
    private readonly channelAccess: ChannelAccessService,
    private readonly chatBlocks: ChatBlockService,
  ) {}

  async toggleReaction(
    messageId: string,
    chapterId: string,
    userId: string,
    emoji: string,
  ) {
    await this.channelAccess.assertMessageAccess(messageId, chapterId, userId);

    const existing = await this.reactionRepo.findOne(messageId, userId, emoji);

    if (existing) {
      await this.reactionRepo.delete(messageId, userId, emoji);
      return { action: 'removed' as const };
    }

    const reaction = await this.reactionRepo.create({
      message_id: messageId,
      user_id: userId,
      emoji,
    });
    return { action: 'added' as const, reaction };
  }

  /**
   * Reactions on one message from the legacy `message_reactions` table, without
   * those of members the caller has blocked (#2324).
   *
   * No client reads this route. Both render reaction chips from
   * `chat_message_actions`, which they read directly under RLS. The route is
   * still live, though, and "the blocker never sees the blocked member's
   * reaction chrome" is a rule about every surface, not just the ones our
   * clients happen to call. It fails closed like every other read here: a block
   * list that cannot be read throws.
   */
  async getReactions(messageId: string, chapterId: string, userId: string) {
    await this.channelAccess.assertMessageAccess(messageId, chapterId, userId);
    const [reactions, blockedUserIds] = await Promise.all([
      this.reactionRepo.findByMessage(messageId),
      this.chatBlocks.listBlockedUserIds(chapterId, userId),
    ]);
    const blocked = new Set(blockedUserIds);
    return reactions.filter(
      (reaction) => !isFromBlockedSender(reaction.user_id, blocked),
    );
  }

  /**
   * Hot-path action / reaction / vote. Mirrors the retired `chat-react`
   * Edge Function. Writes to `chat_message_actions` (Chunk 02) — distinct
   * from the legacy `message_reactions` table used by `toggleReaction`.
   *
   * - Authorizes via message → channel → chapter membership.
   * - Atomic dedup via the unique index `(message_id, user_id, action_type)`:
   *   a 23505 from the insert surfaces as `deduplicated: true` (HTTP 200)
   *   instead of a 5xx — no read-then-insert TOCTOU.
   * - Vote-change semantics (ADR-07): when `action_type === "vote"` the
   *   23505 path UPSERTS instead — same row id, replaced `payload`,
   *   bumped `created_at` — so subscribed clients see a Realtime UPDATE
   *   rather than a second row.
   */
  async recordMessageAction(
    messageId: string,
    chapterId: string,
    userId: string,
    input: { action_type: string; payload?: Record<string, unknown> | null },
    enabledModules: EnabledModules,
  ): Promise<{
    action: ChatMessageAction;
    deduplicated: boolean;
    updated?: boolean;
  }> {
    const message = await this.channelAccess.assertMessageAccess(
      messageId,
      chapterId,
      userId,
    );

    const payload = input.payload ?? {};
    const isVote = input.action_type === VOTE_ACTION_TYPE;

    // #871: this path used to check channel access and then insert whatever it
    // was handed, so a member could vote on a closed poll, pick an option that
    // does not exist, or send several selections to a single-choice poll —
    // every one of which the polls surface rejects for the same poll. The rules
    // are shared with `PollService.vote`; only the encoding differs, since this
    // side addresses options by id rather than by index.
    if (isVote && message.kind === 'poll') {
      // A vote is a write to the Polls module, so it is frozen with the module
      // (#2993), exactly as `POST /v1/polls/:id/vote` is by its controller's
      // `@RequireModule('polls')`. Reading the card and its tally is not
      // gated, and neither is an emoji reaction on it, which belongs to chat.
      // Before the poll rules, so a closed poll in a disabled module reports
      // the module rather than a deadline nobody can act on.
      assertModuleEnabled(enabledModules, 'polls');
      assertCardPollVoteAllowed(message.payload, payload);
    }

    try {
      const action = await this.actionRepo.create({
        message_id: messageId,
        user_id: userId,
        action_type: input.action_type,
        payload,
      });
      return { action, deduplicated: false };
    } catch (error) {
      if (!(error instanceof ChatMessageActionDuplicateError)) throw error;

      if (isVote) {
        const updated = await this.actionRepo.updateForVote(
          messageId,
          userId,
          input.action_type,
          payload,
        );
        if (!updated) throw error;
        return { action: updated, deduplicated: false, updated: true };
      }

      const existing = await this.actionRepo.findOne(
        messageId,
        userId,
        input.action_type,
      );
      if (!existing) throw error;
      return { action: existing, deduplicated: true };
    }
  }
}
