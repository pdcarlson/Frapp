import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { moduleDisabledMessage } from '@repo/validation';
import { ChatReactionService } from './chat-reaction.service';
import {
  baseMessage,
  createChatServiceFixture,
  type ChatServiceFixture,
} from '#test/helpers/chat-service.fixture';
import { ChatMessageActionDuplicateError } from '#domain/repositories/chat.repository.interface';
import type {
  ChatMessage,
  ChatMessageAction,
  MessageReaction,
} from '#domain/entities/chat.entity';

// Moved out of `chat.service.spec.ts` with the methods (#1380).
describe('ChatReactionService', () => {
  let reactions: ChatReactionService;
  let mockMessageRepo: ChatServiceFixture['mockMessageRepo'];
  let mockActionRepo: ChatServiceFixture['mockActionRepo'];
  let mockReactionRepo: ChatServiceFixture['mockReactionRepo'];
  let mockMemberRepo: ChatServiceFixture['mockMemberRepo'];
  let mockNotificationService: ChatServiceFixture['mockNotificationService'];
  let mockChatBlocks: ChatServiceFixture['mockChatBlocks'];

  beforeEach(async () => {
    ({
      reactions,
      mockMessageRepo,
      mockActionRepo,
      mockReactionRepo,
      mockMemberRepo,
      mockNotificationService,
      mockChatBlocks,
    } = await createChatServiceFixture());
  });

  // ── Reactions ────────────────────────────────────────────────────────

  describe('toggleReaction', () => {
    it('should add a reaction when none exists', async () => {
      mockReactionRepo.findOne.mockResolvedValue(null);
      const newReaction: MessageReaction = {
        id: 'rxn-1',
        message_id: 'msg-1',
        user_id: 'user-1',
        emoji: '👍',
        created_at: '2026-01-01T12:00:00.000Z',
      };
      mockReactionRepo.create.mockResolvedValue(newReaction);

      const result = await reactions.toggleReaction(
        'msg-1',
        'ch-1',
        'user-1',
        '👍',
      );
      expect(result.action).toBe('added');
    });

    it('should remove a reaction when it already exists', async () => {
      const existing: MessageReaction = {
        id: 'rxn-1',
        message_id: 'msg-1',
        user_id: 'user-1',
        emoji: '👍',
        created_at: '2026-01-01T12:00:00.000Z',
      };
      mockReactionRepo.findOne.mockResolvedValue(existing);
      mockReactionRepo.delete.mockResolvedValue();

      const result = await reactions.toggleReaction(
        'msg-1',
        'ch-1',
        'user-1',
        '👍',
      );
      expect(result.action).toBe('removed');
    });

    it('should reject reacting to a message the caller cannot access', async () => {
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(null);

      await expect(
        reactions.toggleReaction('msg-1', 'ch-1', 'outsider', '👍'),
      ).rejects.toThrow(ForbiddenException);
      expect(mockReactionRepo.create).not.toHaveBeenCalled();
    });
  });

  describe('getReactions', () => {
    function reaction(id: string, userId: string): MessageReaction {
      return {
        id,
        message_id: 'msg-1',
        user_id: userId,
        emoji: '👍',
        created_at: '2026-01-01T12:00:00.000Z',
      };
    }

    it('drops the reactions of a member the caller has blocked', async () => {
      mockChatBlocks.listBlockedUserIds.mockResolvedValue(['user-blocked']);
      mockReactionRepo.findByMessage.mockResolvedValue([
        reaction('rxn-1', 'user-2'),
        reaction('rxn-2', 'user-blocked'),
      ]);

      const result = await reactions.getReactions('msg-1', 'ch-1', 'user-1');

      expect(result.map((row) => row.id)).toEqual(['rxn-1']);
      expect(mockChatBlocks.listBlockedUserIds).toHaveBeenCalledWith(
        'ch-1',
        'user-1',
      );
    });

    it('fails the read when the block list cannot be read', async () => {
      mockChatBlocks.listBlockedUserIds.mockRejectedValue(new Error('pg down'));
      mockReactionRepo.findByMessage.mockResolvedValue([
        reaction('rxn-2', 'user-blocked'),
      ]);

      await expect(
        reactions.getReactions('msg-1', 'ch-1', 'user-1'),
      ).rejects.toThrow('pg down');
    });

    it('authorizes the message before reading anything', async () => {
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(null);

      await expect(
        reactions.getReactions('msg-1', 'ch-1', 'outsider'),
      ).rejects.toThrow(ForbiddenException);
      expect(mockReactionRepo.findByMessage).not.toHaveBeenCalled();
      expect(mockChatBlocks.listBlockedUserIds).not.toHaveBeenCalled();
    });
  });

  describe('reaction writes notify nobody (#2324)', () => {
    // "The blocker never gets a reaction ping from the blocked member" holds
    // today because no reaction notifies anyone: the push worker fans out on
    // `chat_messages` INSERT only. This pins that. A reaction push added later
    // has to decide what a block does to it first — see
    // `chat-read-surface-ledger.spec.ts`.

    it('does not notify on a legacy reaction toggle', async () => {
      mockReactionRepo.findOne.mockResolvedValue(null);
      mockReactionRepo.create.mockResolvedValue({
        id: 'rxn-1',
        message_id: 'msg-1',
        user_id: 'user-1',
        emoji: '👍',
        created_at: '2026-01-01T12:00:00.000Z',
      });

      await reactions.toggleReaction('msg-1', 'ch-1', 'user-1', '👍');

      expect(mockNotificationService.notifyUser).not.toHaveBeenCalled();
      expect(mockNotificationService.notifyChapter).not.toHaveBeenCalled();
    });

    it('does not notify on a hot-path reaction action', async () => {
      mockActionRepo.create.mockResolvedValue({
        id: 'act-1',
        message_id: 'msg-1',
        user_id: 'user-1',
        action_type: 'reaction:👍',
        payload: {},
        created_at: '2026-01-01T12:00:00.000Z',
      });

      await reactions.recordMessageAction(
        'msg-1',
        'ch-1',
        'user-1',
        {
          action_type: 'reaction:👍',
        },
        null,
      );

      expect(mockNotificationService.notifyUser).not.toHaveBeenCalled();
      expect(mockNotificationService.notifyChapter).not.toHaveBeenCalled();
    });
  });

  // ── Hot-path actions (chat_message_actions) ──────────────────────────

  describe('recordMessageAction', () => {
    const baseAction: ChatMessageAction = {
      id: 'action-1',
      message_id: 'msg-1',
      user_id: 'user-1',
      action_type: 'reaction:👍',
      payload: {},
      created_at: '2026-01-01T12:00:00.000Z',
    };

    describe('poll-card vote validation (#871)', () => {
      // The card payload the composer writes (@repo/chat-core/dispatch):
      // options carry ids, and the deadline is `closes_at`.
      const pollMessage: ChatMessage = {
        ...baseMessage,
        kind: 'poll',
        payload: {
          question: 'Formal venue?',
          options: [
            { id: 'opt-a', label: 'The Lodge' },
            { id: 'opt-b', label: 'Riverside' },
          ],
          closes_at: null,
        },
      };

      const vote = (
        payload: Record<string, unknown>,
        enabledModules: Record<string, boolean> | null = null,
      ) =>
        reactions.recordMessageAction(
          'msg-1',
          'ch-1',
          'user-1',
          {
            action_type: 'vote',
            payload,
          },
          enabledModules,
        );

      // A vote is a Polls write, frozen with the module like
      // `POST /v1/polls/:id/vote` (#2993); reading the card is not gated.
      it('refuses a vote while Polls is off, before the poll rules run', async () => {
        mockMessageRepo.findById.mockResolvedValue({
          ...pollMessage,
          payload: {
            ...pollMessage.payload,
            closes_at: '2020-01-01T00:00:00.000Z',
          },
        });

        const refusal = await vote(
          { option_id: 'opt-a' },
          {
            polls: false,
          },
        ).catch((error: unknown) => error);

        expect(refusal).toBeInstanceOf(ForbiddenException);
        expect((refusal as ForbiddenException).getResponse()).toEqual({
          code: 'chapter.module.disabled',
          message: moduleDisabledMessage('polls'),
        });
        expect(mockActionRepo.create).not.toHaveBeenCalled();
      });

      it('records a vote while Polls is on or has no key', async () => {
        mockMessageRepo.findById.mockResolvedValue(pollMessage);
        mockActionRepo.create.mockResolvedValue({
          ...baseAction,
          action_type: 'vote',
        });

        await vote({ option_id: 'opt-a' }, { polls: true });
        await vote({ option_id: 'opt-a' }, { events: false });

        expect(mockActionRepo.create).toHaveBeenCalledTimes(2);
      });

      it('still takes a reaction on a poll card while Polls is off', async () => {
        // A reaction belongs to chat, which can't be switched off.
        mockMessageRepo.findById.mockResolvedValue(pollMessage);
        mockActionRepo.create.mockResolvedValue(baseAction);

        await expect(
          reactions.recordMessageAction(
            'msg-1',
            'ch-1',
            'user-1',
            { action_type: 'reaction:👍' },
            { polls: false },
          ),
        ).resolves.toMatchObject({ deduplicated: false });
      });

      it('rejects a vote on a closed poll', async () => {
        mockMessageRepo.findById.mockResolvedValue({
          ...pollMessage,
          payload: {
            ...pollMessage.payload,
            closes_at: '2020-01-01T00:00:00.000Z',
          },
        });

        await expect(vote({ option_id: 'opt-a' })).rejects.toThrow(
          BadRequestException,
        );
        expect(mockActionRepo.create).not.toHaveBeenCalled();
      });

      it('rejects an option that is not on the card', async () => {
        mockMessageRepo.findById.mockResolvedValue(pollMessage);

        await expect(vote({ option_id: 'opt-z' })).rejects.toThrow(
          /Invalid option/,
        );
        expect(mockActionRepo.create).not.toHaveBeenCalled();
      });

      it('rejects several selections on a single-choice card', async () => {
        mockMessageRepo.findById.mockResolvedValue(pollMessage);

        await expect(vote({ option_id: ['opt-a', 'opt-b'] })).rejects.toThrow(
          /exactly one option/,
        );
        expect(mockActionRepo.create).not.toHaveBeenCalled();
      });

      it('still records a valid vote', async () => {
        mockMessageRepo.findById.mockResolvedValue(pollMessage);
        mockActionRepo.create.mockResolvedValue({
          ...baseAction,
          action_type: 'vote',
        });

        await expect(vote({ option_id: 'opt-a' })).resolves.toMatchObject({
          deduplicated: false,
        });
        expect(mockActionRepo.create).toHaveBeenCalled();
      });

      it('leaves non-vote actions on a poll card alone', async () => {
        // Reactions on a poll card are not votes and must not be rule-checked.
        mockMessageRepo.findById.mockResolvedValue(pollMessage);
        mockActionRepo.create.mockResolvedValue(baseAction);

        await expect(
          reactions.recordMessageAction(
            'msg-1',
            'ch-1',
            'user-1',
            {
              action_type: 'reaction:👍',
            },
            null,
          ),
        ).resolves.toMatchObject({ deduplicated: false });
      });
    });

    it('records a reaction and returns deduplicated:false on the happy path', async () => {
      mockActionRepo.create.mockResolvedValue(baseAction);

      const result = await reactions.recordMessageAction(
        'msg-1',
        'ch-1',
        'user-1',
        { action_type: 'reaction:👍' },
        null,
      );

      expect(result).toEqual({ action: baseAction, deduplicated: false });
      expect(mockActionRepo.create).toHaveBeenCalledWith({
        message_id: 'msg-1',
        user_id: 'user-1',
        action_type: 'reaction:👍',
        payload: {},
      });
    });

    it('rejects when the caller cannot access the message', async () => {
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(null);

      await expect(
        reactions.recordMessageAction(
          'msg-1',
          'ch-1',
          'outsider',
          {
            action_type: 'reaction:👍',
          },
          null,
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(mockActionRepo.create).not.toHaveBeenCalled();
    });

    it('on a unique-violation for an emoji reaction, surfaces the existing row as deduplicated:true (no second insert)', async () => {
      mockActionRepo.create.mockRejectedValue(
        new ChatMessageActionDuplicateError('msg-1', 'user-1', 'reaction:👍'),
      );
      mockActionRepo.findOne.mockResolvedValue(baseAction);

      const result = await reactions.recordMessageAction(
        'msg-1',
        'ch-1',
        'user-1',
        { action_type: 'reaction:👍' },
        null,
      );

      expect(result).toEqual({ action: baseAction, deduplicated: true });
      expect(mockActionRepo.create).toHaveBeenCalledTimes(1);
      expect(mockActionRepo.findOne).toHaveBeenCalledWith(
        'msg-1',
        'user-1',
        'reaction:👍',
      );
      expect(mockActionRepo.updateForVote).not.toHaveBeenCalled();
    });

    it('on a unique-violation for action_type="vote", UPSERTS the payload and returns updated:true (ADR-07)', async () => {
      const updatedAction = {
        ...baseAction,
        action_type: 'vote',
        payload: { option: 2 },
      };
      mockActionRepo.create.mockRejectedValue(
        new ChatMessageActionDuplicateError('msg-1', 'user-1', 'vote'),
      );
      mockActionRepo.updateForVote.mockResolvedValue(updatedAction);

      const result = await reactions.recordMessageAction(
        'msg-1',
        'ch-1',
        'user-1',
        { action_type: 'vote', payload: { option: 2 } },
        null,
      );

      expect(result).toEqual({
        action: updatedAction,
        deduplicated: false,
        updated: true,
      });
      expect(mockActionRepo.updateForVote).toHaveBeenCalledWith(
        'msg-1',
        'user-1',
        'vote',
        { option: 2 },
      );
    });

    it('on a unique-violation for vote, rethrows the same ChatMessageActionDuplicateError when updateForVote finds no row', async () => {
      // Race: unique-violation on create, then the action row is gone before
      // the UPSERT. updateForVote must return null (not throw PGRST116) so
      // this branch can re-raise the original duplicate error instead of a 500.
      const duplicate = new ChatMessageActionDuplicateError(
        'msg-1',
        'user-1',
        'vote',
      );
      mockActionRepo.create.mockRejectedValue(duplicate);
      mockActionRepo.updateForVote.mockResolvedValue(null);

      await expect(
        reactions.recordMessageAction(
          'msg-1',
          'ch-1',
          'user-1',
          {
            action_type: 'vote',
            payload: { option: 2 },
          },
          null,
        ),
      ).rejects.toBe(duplicate);
      expect(mockActionRepo.findOne).not.toHaveBeenCalled();
    });

    it('rethrows non-23505 insert errors instead of falsely deduping', async () => {
      mockActionRepo.create.mockRejectedValue(new Error('schema mismatch'));

      await expect(
        reactions.recordMessageAction(
          'msg-1',
          'ch-1',
          'user-1',
          {
            action_type: 'reaction:👍',
          },
          null,
        ),
      ).rejects.toThrow('schema mismatch');
    });
  });
});
