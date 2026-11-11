import { NotFoundException } from '@nestjs/common';
import {
  ChatImportantService,
  IMPORTANT_CANDIDATE_LIMIT,
  IMPORTANT_LIST_LIMIT,
} from './chat-important.service';
import type { ChannelAccessService } from './channel-access.service';
import type { ChatBlockService } from './chat-block.service';
import type { IChatMessageRepository } from '#domain/repositories/chat.repository.interface';
import type { IChatImportantSeenRepository } from '#domain/repositories/chat-important.repository.interface';
import type { ChatMessage } from '#domain/entities';

const CHAPTER = 'chap-1';
const CHANNEL = 'chan-1';
const ME = 'user-me';
const SAM = 'user-sam';
const BLOCKED = 'user-blocked';
const NOW = new Date('2026-11-11T20:00:00.000Z');

const important = (
  id: string,
  overrides: Partial<ChatMessage> = {},
): ChatMessage =>
  ({
    id,
    channel_id: CHANNEL,
    sender_id: SAM,
    author_name: null,
    content: `message ${id}`,
    kind: 'text',
    is_deleted: false,
    flag: 'important',
    flagged_by: SAM,
    flagged_at: '2026-11-11T15:00:00.000Z',
    created_at: '2026-11-11T15:00:00.000Z',
    ...overrides,
  }) as ChatMessage;

describe('ChatImportantService', () => {
  let messages: ChatMessage[];
  let seen: Set<string>;
  let blocked: string[];
  let messageRepo: { findImportantInChannel: jest.Mock };
  let seenRepo: jest.Mocked<IChatImportantSeenRepository>;
  let channelAccess: { assertChannelAccess: jest.Mock };
  let chatBlocks: { listBlockedUserIds: jest.Mock };
  let service: ChatImportantService;

  beforeEach(() => {
    messages = [];
    seen = new Set();
    blocked = [];
    messageRepo = {
      findImportantInChannel: jest.fn(() => Promise.resolve(messages)),
    };
    seenRepo = {
      findSeenMessageIds: jest.fn((_c, _u, ids: readonly string[]) =>
        Promise.resolve(new Set(ids.filter((id) => seen.has(id)))),
      ),
      markSeen: jest.fn((_c, _u, ids: readonly string[]) => {
        ids.forEach((id) => seen.add(id));
        return Promise.resolve();
      }),
    };
    channelAccess = { assertChannelAccess: jest.fn().mockResolvedValue({}) };
    chatBlocks = {
      listBlockedUserIds: jest.fn(() => Promise.resolve(blocked)),
    };
    service = new ChatImportantService(
      messageRepo as unknown as IChatMessageRepository,
      seenRepo,
      channelAccess as unknown as ChannelAccessService,
      chatBlocks as unknown as ChatBlockService,
    );
  });

  describe('listUnseen', () => {
    it('authorizes the channel before reading anything', async () => {
      channelAccess.assertChannelAccess.mockRejectedValue(
        new NotFoundException('Channel not found'),
      );

      await expect(
        service.listUnseen(CHANNEL, CHAPTER, ME, NOW),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(channelAccess.assertChannelAccess).toHaveBeenCalledWith(
        CHANNEL,
        CHAPTER,
        ME,
      );
      expect(messageRepo.findImportantInChannel).not.toHaveBeenCalled();
    });

    it('reads only the last 14 days of flags, capped', async () => {
      await service.listUnseen(CHANNEL, CHAPTER, ME, NOW);

      expect(messageRepo.findImportantInChannel).toHaveBeenCalledWith(
        CHANNEL,
        '2026-10-28T20:00:00.000Z',
        IMPORTANT_CANDIDATE_LIMIT,
      );
    });

    it('lists unseen Important messages oldest first, with a one-line excerpt', async () => {
      messages = [
        important('m2', {
          created_at: '2026-11-11T16:00:00.000Z',
          content: 'tie too.\nchapter colors',
        }),
        important('m1', { created_at: '2026-11-11T15:00:00.000Z' }),
      ];

      const answer = await service.listUnseen(CHANNEL, CHAPTER, ME, NOW);

      expect(answer.total).toBe(2);
      expect(answer.messages.map((m) => m.id)).toEqual(['m1', 'm2']);
      expect(answer.messages[1]).toEqual({
        id: 'm2',
        created_at: '2026-11-11T16:00:00.000Z',
        flagged_at: '2026-11-11T15:00:00.000Z',
        sender_id: SAM,
        author_name: null,
        excerpt: 'tie too. chapter colors',
      });
    });

    it('cuts a long excerpt with an ellipsis', async () => {
      messages = [important('m1', { content: 'x'.repeat(300) })];

      const [ref] = (await service.listUnseen(CHANNEL, CHAPTER, ME, NOW))
        .messages;

      expect(ref.excerpt).toHaveLength(140);
      expect(ref.excerpt.endsWith('…')).toBe(true);
    });

    it('leaves out the caller’s own messages and the ones they flagged', async () => {
      messages = [
        important('mine', { sender_id: ME, flagged_by: ME }),
        important('flagged-by-me', { flagged_by: ME }),
        important('theirs'),
      ];

      const answer = await service.listUnseen(CHANNEL, CHAPTER, ME, NOW);

      expect(answer.messages.map((m) => m.id)).toEqual(['theirs']);
    });

    it('leaves out a message whose sender the caller blocked', async () => {
      blocked = [BLOCKED];
      messages = [
        important('blocked', { sender_id: BLOCKED, flagged_by: SAM }),
        important('ok'),
      ];

      const answer = await service.listUnseen(CHANNEL, CHAPTER, ME, NOW);

      expect(answer.messages.map((m) => m.id)).toEqual(['ok']);
      expect(chatBlocks.listBlockedUserIds).toHaveBeenCalledWith(CHAPTER, ME);
    });

    it('keeps a message whose flagger, not sender, the caller blocked', async () => {
      // A flag is chapter state a block counts rather than hides
      // (§ Message flags, Blocks); the answer never names the flagger.
      blocked = [BLOCKED];
      messages = [important('m1', { flagged_by: BLOCKED })];

      const answer = await service.listUnseen(CHANNEL, CHAPTER, ME, NOW);

      expect(answer.messages.map((m) => m.id)).toEqual(['m1']);
      expect(answer.messages[0]).not.toHaveProperty('flagged_by');
    });

    it('leaves out what the caller has seen', async () => {
      messages = [important('seen'), important('unseen')];
      seen.add('seen');

      const answer = await service.listUnseen(CHANNEL, CHAPTER, ME, NOW);

      expect(answer.messages.map((m) => m.id)).toEqual(['unseen']);
      expect(seenRepo.findSeenMessageIds).toHaveBeenCalledWith(CHAPTER, ME, [
        'seen',
        'unseen',
      ]);
    });

    it('names an imported row by its Discord author', async () => {
      messages = [
        important('imp', {
          sender_id: null,
          author_name: 'oldtimer',
          kind: 'imported',
        }),
      ];

      const [ref] = (await service.listUnseen(CHANNEL, CHAPTER, ME, NOW))
        .messages;

      expect(ref).toMatchObject({ sender_id: null, author_name: 'oldtimer' });
    });

    it('lists at most 50 and counts them all', async () => {
      messages = Array.from({ length: 60 }, (_, i) =>
        important(`m${String(i).padStart(2, '0')}`),
      );

      const answer = await service.listUnseen(CHANNEL, CHAPTER, ME, NOW);

      expect(answer.total).toBe(60);
      expect(answer.messages).toHaveLength(IMPORTANT_LIST_LIMIT);
      expect(answer.messages[0].id).toBe('m00');
    });
  });

  describe('markSeen', () => {
    it('writes only ids the strip counts for the caller in this channel', async () => {
      blocked = [BLOCKED];
      messages = [
        important('a'),
        important('b'),
        important('mine', { sender_id: ME }),
        important('blocked', { sender_id: BLOCKED }),
      ];

      await service.markSeen(
        CHANNEL,
        CHAPTER,
        ME,
        ['a', 'mine', 'blocked', 'elsewhere'],
        NOW,
      );

      expect(seenRepo.markSeen).toHaveBeenCalledWith(CHAPTER, ME, ['a']);
    });

    it('answers markSeen with the same exclusions as the list', async () => {
      blocked = [BLOCKED];
      messages = [
        important('a'),
        important('b'),
        important('blocked', { sender_id: BLOCKED }),
      ];

      const answer = await service.markSeen(CHANNEL, CHAPTER, ME, ['a'], NOW);

      expect(answer).toEqual({
        messages: [expect.objectContaining({ id: 'b' })],
        total: 1,
      });
    });

    it('authorizes the channel before writing', async () => {
      channelAccess.assertChannelAccess.mockRejectedValue(
        new NotFoundException('Channel not found'),
      );

      await expect(
        service.markSeen(CHANNEL, CHAPTER, ME, ['a'], NOW),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(seenRepo.markSeen).not.toHaveBeenCalled();
    });
  });

  describe('dismissAll', () => {
    it('marks every counted message seen and answers an empty strip', async () => {
      messages = [important('a'), important('b'), important('c')];
      seen.add('c');

      const answer = await service.dismissAll(CHANNEL, CHAPTER, ME, NOW);

      expect(seenRepo.markSeen).toHaveBeenCalledWith(CHAPTER, ME, ['a', 'b']);
      expect(answer).toEqual({ messages: [], total: 0 });
      expect((await service.listUnseen(CHANNEL, CHAPTER, ME, NOW)).total).toBe(
        0,
      );
    });

    it('authorizes the channel before writing', async () => {
      channelAccess.assertChannelAccess.mockRejectedValue(
        new NotFoundException('Channel not found'),
      );

      await expect(
        service.dismissAll(CHANNEL, CHAPTER, ME, NOW),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(seenRepo.markSeen).not.toHaveBeenCalled();
    });
  });
});
