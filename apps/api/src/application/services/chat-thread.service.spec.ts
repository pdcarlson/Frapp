import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { ChatChannel, ChatMessage } from '#domain/entities/chat.entity';
import {
  baseChannel,
  baseMessage,
  createChatServiceFixture,
  type ChatServiceFixture,
} from '../../../test/helpers/chat-service.fixture';
import type { ChatService } from './chat.service';
import { ChatThreadService } from './chat-thread.service';

/**
 * Message threads (#3785, spec/behavior/chat/README.md § Message threads):
 * sending into a thread through `ChatService.sendMessage`, and the thread
 * reads and follows in `ChatThreadService`.
 */
const root: ChatMessage = {
  ...baseMessage,
  id: 'root-1',
  sender_id: 'author-1',
  thread_root_id: null,
};

const reply: ChatMessage = {
  ...baseMessage,
  id: 'reply-1',
  sender_id: 'user-1',
  thread_root_id: 'root-1',
  created_at: '2026-01-01T12:05:00.000Z',
};

const announcements: ChatChannel = {
  ...baseChannel,
  name: 'announcements',
  is_read_only: true,
};

describe('ChatService.sendMessage into a thread', () => {
  let service: ChatService;
  let f: ChatServiceFixture;

  beforeEach(async () => {
    f = await createChatServiceFixture();
    service = f.service;
    f.mockMessageRepo.findById.mockImplementation(async (id: string) =>
      id === 'root-1' ? root : id === 'reply-1' ? reply : null,
    );
    f.mockMessageRepo.create.mockResolvedValue(reply);
  });

  const send = (extra: Record<string, unknown> = {}) =>
    service.sendMessage({
      chapter_id: 'ch-1',
      channel_id: 'ch-chan-1',
      sender_id: 'user-1',
      content: 'In the thread',
      thread_root_id: 'root-1',
      ...extra,
    });

  it('writes the reply with its root and follows the sender and the root’s author first', async () => {
    const order: string[] = [];
    f.mockThreadRepo.ensureFollowing.mockImplementation(async () => {
      order.push('follow');
    });
    f.mockMessageRepo.create.mockImplementation(async () => {
      order.push('insert');
      return reply;
    });

    await send();

    expect(f.mockMessageRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ thread_root_id: 'root-1', reply_to_id: null }),
    );
    expect(f.mockThreadRepo.ensureFollowing).toHaveBeenCalledWith(
      'root-1',
      'ch-chan-1',
      ['user-1', 'author-1'],
    );
    // The push worker reacts to the insert, so the follows must already exist.
    expect(order).toEqual(['follow', 'insert']);
    expect(f.mockThreadRepo.markRead).toHaveBeenCalledWith(
      'root-1',
      'ch-chan-1',
      'user-1',
      reply.created_at,
    );
  });

  it('lets any reader reply in a thread under an announcement, without announcements:post', async () => {
    f.mockChannelRepo.findById.mockResolvedValue(announcements);
    f.mockRbac.getEffectivePermissions.mockResolvedValue([]);

    await expect(send()).resolves.toEqual({
      message: reply,
      deduplicated: false,
    });
  });

  it('still refuses a member’s top-level post in an announcement', async () => {
    f.mockChannelRepo.findById.mockResolvedValue(announcements);
    f.mockRbac.getEffectivePermissions.mockResolvedValue([]);

    await expect(send({ thread_root_id: undefined })).rejects.toThrow();
    expect(f.mockMessageRepo.create).not.toHaveBeenCalled();
  });

  it('refuses a thread in a 1:1 DM', async () => {
    f.mockChannelRepo.findById.mockResolvedValue({
      ...baseChannel,
      type: 'DM',
      member_ids: ['user-1', 'author-1'],
    });

    await expect(send()).rejects.toThrow(BadRequestException);
    expect(f.mockMessageRepo.create).not.toHaveBeenCalled();
  });

  it('refuses a thread in the audit log', async () => {
    f.mockChannelRepo.findById.mockResolvedValue({
      ...baseChannel,
      is_read_only: true,
      is_audit_log: true,
    });

    await expect(send()).rejects.toThrow();
    expect(f.mockMessageRepo.create).not.toHaveBeenCalled();
  });

  it('refuses a thread on a thread reply (no nesting)', async () => {
    await expect(send({ thread_root_id: 'reply-1' })).rejects.toThrow(
      'A thread cannot be started on a thread reply',
    );
  });

  it('refuses a root from another channel', async () => {
    f.mockMessageRepo.findById.mockResolvedValue({
      ...root,
      channel_id: 'other-channel',
    });

    await expect(send()).rejects.toThrow(BadRequestException);
  });

  it('refuses a thread reply that also quote-replies', async () => {
    await expect(send({ reply_to_id: 'root-1' })).rejects.toThrow(
      BadRequestException,
    );
    expect(f.mockMessageRepo.create).not.toHaveBeenCalled();
  });

  it('refuses a timeline quote of a thread reply', async () => {
    await expect(
      send({ thread_root_id: undefined, reply_to_id: 'reply-1' }),
    ).rejects.toThrow('reply_to_id cannot reference a reply inside a thread');
  });

  it('does not fail a committed reply when the read cursor cannot move', async () => {
    f.mockThreadRepo.markRead.mockRejectedValue(new Error('db down'));

    await expect(send()).resolves.toEqual({
      message: reply,
      deduplicated: false,
    });
  });

  it('touches no thread state on a timeline send', async () => {
    f.mockMessageRepo.create.mockResolvedValue(baseMessage);

    await send({ thread_root_id: undefined });

    expect(f.mockThreadRepo.ensureFollowing).not.toHaveBeenCalled();
    expect(f.mockThreadRepo.markRead).not.toHaveBeenCalled();
  });
});

describe('ChatThreadService', () => {
  const messageRepo = { findById: jest.fn() };
  const threads = {
    findReplies: jest.fn(),
    findFollow: jest.fn(),
    setFollowState: jest.fn(),
    markRead: jest.fn(),
    findFollowedUnread: jest.fn(),
  };
  const channelAccess = { assertChannelAccess: jest.fn() };
  const chatBlocks = { listBlockedUserIds: jest.fn() };
  let service: ChatThreadService;

  beforeEach(() => {
    jest.resetAllMocks();
    channelAccess.assertChannelAccess.mockResolvedValue(baseChannel);
    chatBlocks.listBlockedUserIds.mockResolvedValue([]);
    messageRepo.findById.mockResolvedValue(root);
    threads.findReplies.mockResolvedValue([reply]);
    threads.findFollow.mockResolvedValue(null);
    service = new ChatThreadService(
      messageRepo as never,
      threads as never,
      channelAccess as never,
      chatBlocks as never,
    );
  });

  it('answers 404 for a root in another channel', async () => {
    messageRepo.findById.mockResolvedValue({ ...root, channel_id: 'other' });

    await expect(
      service.getThread('ch-chan-1', 'root-1', 'ch-1', 'user-1'),
    ).rejects.toThrow(NotFoundException);
  });

  it('answers 404 for a thread reply passed as a root', async () => {
    messageRepo.findById.mockResolvedValue(reply);

    await expect(
      service.getReplies('ch-chan-1', 'reply-1', 'ch-1', 'user-1'),
    ).rejects.toThrow(NotFoundException);
    expect(threads.findReplies).not.toHaveBeenCalled();
  });

  it('authorizes the channel before reading the root', async () => {
    channelAccess.assertChannelAccess.mockRejectedValue(
      new NotFoundException('Channel not found'),
    );

    await expect(
      service.getReplies('ch-chan-1', 'root-1', 'ch-1', 'user-1'),
    ).rejects.toThrow('Channel not found');
    expect(messageRepo.findById).not.toHaveBeenCalled();
  });

  it('masks replies from a member the caller blocked', async () => {
    chatBlocks.listBlockedUserIds.mockResolvedValue(['user-1']);

    const [masked] = await service.getReplies(
      'ch-chan-1',
      'root-1',
      'ch-1',
      'viewer',
    );

    expect(masked.sender_blocked).toBe(true);
    expect(masked.content).not.toBe(reply.content);
  });

  it('returns the caller’s follow with the root', async () => {
    threads.findFollow.mockResolvedValue({
      state: 'muted',
      last_read_at: '2026-01-01T13:00:00.000Z',
    });

    await expect(
      service.getThread('ch-chan-1', 'root-1', 'ch-1', 'user-1'),
    ).resolves.toEqual(
      expect.objectContaining({
        follow_state: 'muted',
        last_read_at: '2026-01-01T13:00:00.000Z',
      }),
    );
  });

  it('unfollows on `none`', async () => {
    await expect(
      service.setFollow('ch-chan-1', 'root-1', 'ch-1', 'user-1', 'none'),
    ).resolves.toEqual({ follow_state: null });
    expect(threads.setFollowState).toHaveBeenCalledWith(
      'root-1',
      'ch-chan-1',
      'user-1',
      null,
    );
  });

  it('refuses to follow in a 1:1 DM', async () => {
    channelAccess.assertChannelAccess.mockResolvedValue({
      ...baseChannel,
      type: 'DM',
    });

    await expect(
      service.setFollow('ch-chan-1', 'root-1', 'ch-1', 'user-1', 'following'),
    ).rejects.toThrow(BadRequestException);
    expect(threads.setFollowState).not.toHaveBeenCalled();
  });
});
