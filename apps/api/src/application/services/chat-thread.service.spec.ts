import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { ChatChannel, ChatMessage } from '#domain/entities/chat.entity';
import { EMPTY_ACCESS_HOLDER } from '#domain/utils/channel-access';
import type { ChannelAccessHolder } from '#domain/utils/channel-access';
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

// Only the officers' tier may post in `#announcements` (#3722).
const OFFICERS = 'tier:00000000-0000-4000-8000-0000000071e1';
const announcements: ChatChannel = {
  ...baseChannel,
  name: 'announcements',
  is_read_only: true,
  who_can_post: [OFFICERS],
};

/** An ordinary member: holds a role, but nothing on who can post. */
const MEMBER: ChannelAccessHolder = {
  ...EMPTY_ACCESS_HOLDER,
  entries: new Set(['role:00000000-0000-4000-8000-0000000000aa']),
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
    f.mockThreadRepo.followOnReply.mockImplementation(async () => {
      order.push('follow-sender');
    });
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
    expect(f.mockThreadRepo.followOnReply).toHaveBeenCalledWith(
      'root-1',
      'ch-chan-1',
      'user-1',
    );
    expect(f.mockThreadRepo.ensureFollowing).toHaveBeenCalledWith(
      'root-1',
      'ch-chan-1',
      ['author-1'],
    );
    // The push worker reacts to the insert, so the follows must already exist.
    expect(order).toEqual(['follow-sender', 'follow', 'insert']);
    expect(f.mockThreadRepo.markRead).toHaveBeenCalledWith(
      'root-1',
      'ch-chan-1',
      'user-1',
      reply.created_at,
    );
  });

  it('follows the root’s author on the first reply only, so their unfollow sticks', async () => {
    f.mockMessageRepo.findById.mockResolvedValue({
      ...root,
      thread_reply_count: 2,
    });

    await send();

    expect(f.mockThreadRepo.ensureFollowing).toHaveBeenCalledWith(
      'root-1',
      'ch-chan-1',
      [],
    );
  });

  it('follows everyone the reply mentions', async () => {
    f.mockMemberRepo.findByChapter.mockResolvedValue([
      { user_id: 'mentioned-1', display_name: 'Sam' },
    ]);
    const mentions = jest
      .spyOn(
        (service as unknown as { mentions: { resolveForSend: () => unknown } })
          .mentions,
        'resolveForSend',
      )
      .mockResolvedValue(['mentioned-1'] as never);

    await send({ content: 'cc @Sam' });

    expect(mentions).toHaveBeenCalled();
    expect(f.mockThreadRepo.ensureFollowing).toHaveBeenCalledWith(
      'root-1',
      'ch-chan-1',
      ['author-1', 'mentioned-1'],
    );
  });

  it('refuses an imported message as a root, which the import purge would delete with its replies', async () => {
    f.mockMessageRepo.findById.mockResolvedValue({ ...root, kind: 'imported' });

    await expect(send()).rejects.toThrow(
      'An imported message cannot be threaded',
    );
    expect(f.mockMessageRepo.create).not.toHaveBeenCalled();
  });

  it('lets a member edit their own thread reply under an announcement', async () => {
    f.mockChannelRepo.findById.mockResolvedValue(announcements);
    f.mockRbac.getChannelAccessHolder.mockResolvedValue(MEMBER);
    f.mockMessageRepo.findById.mockResolvedValue(reply);
    f.mockMessageRepo.update.mockResolvedValue({ ...reply, content: 'fixed' });

    await expect(
      service.editMessage('reply-1', 'ch-1', 'user-1', 'fixed'),
    ).resolves.toEqual(expect.objectContaining({ content: 'fixed' }));
  });

  it('still refuses a member editing a timeline post in an announcement', async () => {
    f.mockChannelRepo.findById.mockResolvedValue(announcements);
    f.mockRbac.getChannelAccessHolder.mockResolvedValue(MEMBER);
    f.mockMessageRepo.findById.mockResolvedValue({
      ...baseMessage,
      sender_id: 'user-1',
    });

    await expect(
      service.editMessage('msg-1', 'ch-1', 'user-1', 'fixed'),
    ).rejects.toThrow();
  });

  it('mints an upload URL for a thread reply under an announcement, and not for the timeline', async () => {
    f.mockChannelRepo.findById.mockResolvedValue(announcements);
    f.mockRbac.getChannelAccessHolder.mockResolvedValue(MEMBER);

    await expect(
      f.attachments.requestChatUploadUrl(
        'ch-chan-1',
        'ch-1',
        'user-1',
        'a.png',
        'image/png',
        10,
        false,
        false,
      ),
    ).rejects.toThrow();
    await expect(
      f.attachments.requestChatUploadUrl(
        'ch-chan-1',
        'ch-1',
        'user-1',
        'a.png',
        'image/png',
        10,
        false,
        true,
      ),
    ).resolves.toBeDefined();
  });

  it('lets any reader reply in a thread under an announcement, without being on who can post', async () => {
    f.mockChannelRepo.findById.mockResolvedValue(announcements);
    f.mockRbac.getChannelAccessHolder.mockResolvedValue(MEMBER);

    await expect(send()).resolves.toEqual({
      message: reply,
      deduplicated: false,
    });
  });

  it('still refuses a member’s top-level post in an announcement', async () => {
    f.mockChannelRepo.findById.mockResolvedValue(announcements);
    f.mockRbac.getChannelAccessHolder.mockResolvedValue(MEMBER);

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
    findMemberThreads: jest.fn(),
    findFollowedChannelIds: jest.fn(),
    findMessagesByIds: jest.fn(),
  };
  const channelAccess = {
    assertChannelAccess: jest.fn(),
    filterAccessibleChannelIds: jest.fn(),
  };
  const chatBlocks = { listBlockedUserIds: jest.fn() };
  const notifications = { markChatChannelNotificationsRead: jest.fn() };
  let service: ChatThreadService;

  beforeEach(() => {
    jest.resetAllMocks();
    channelAccess.assertChannelAccess.mockResolvedValue(baseChannel);
    chatBlocks.listBlockedUserIds.mockResolvedValue([]);
    messageRepo.findById.mockResolvedValue(root);
    threads.findReplies.mockResolvedValue([reply]);
    threads.findFollow.mockResolvedValue(null);
    notifications.markChatChannelNotificationsRead.mockResolvedValue(undefined);
    service = new ChatThreadService(
      messageRepo as never,
      threads as never,
      channelAccess as never,
      chatBlocks as never,
      notifications as never,
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

  it('reports an unfollowed row as not following, keeping its cursor', async () => {
    threads.findFollow.mockResolvedValue({
      state: 'unfollowed',
      last_read_at: '2026-01-01T13:00:00.000Z',
    });

    await expect(
      service.getThread('ch-chan-1', 'root-1', 'ch-1', 'user-1'),
    ).resolves.toEqual(
      expect.objectContaining({
        follow_state: null,
        last_read_at: '2026-01-01T13:00:00.000Z',
      }),
    );
  });

  it('reading a thread clears that thread’s notifications only, and survives a failed clear', async () => {
    notifications.markChatChannelNotificationsRead.mockRejectedValue(
      new Error('down'),
    );

    await expect(
      service.markRead('ch-chan-1', 'root-1', 'ch-1', 'user-1'),
    ).resolves.toEqual({ last_read_at: expect.any(String) });
    expect(notifications.markChatChannelNotificationsRead).toHaveBeenCalledWith(
      'user-1',
      'ch-1',
      'ch-chan-1',
      expect.any(String),
      'root-1',
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

  describe('getMemberThreads (#4960)', () => {
    const row = {
      thread_root_id: 'root-1',
      channel_id: 'ch-chan-1',
      state: 'following' as const,
      last_read_at: null,
      last_reply_at: reply.created_at,
      reply_count: 1,
      unread_count: 1,
    };
    const lastReply = {
      id: 'reply-1',
      sender_id: 'user-2',
      content: 'In the thread',
      kind: 'text',
      attachment_count: 0,
      created_at: reply.created_at,
    };

    beforeEach(() => {
      threads.findFollowedChannelIds.mockResolvedValue([
        'ch-chan-1',
        'lost-chan',
      ]);
      channelAccess.filterAccessibleChannelIds.mockResolvedValue(
        new Set(['ch-chan-1']),
      );
      threads.findMemberThreads.mockResolvedValue([row]);
      threads.findMessagesByIds.mockResolvedValue([
        { ...root, thread_last_reply: lastReply },
      ]);
    });

    it('reads only the chapter channels the caller may still read, then joins the roots', async () => {
      const result = await service.getMemberThreads('ch-1', 'user-1');

      expect(threads.findFollowedChannelIds).toHaveBeenCalledWith(
        'ch-1',
        'user-1',
      );
      expect(channelAccess.filterAccessibleChannelIds).toHaveBeenCalledWith(
        'ch-1',
        'user-1',
        ['ch-chan-1', 'lost-chan'],
      );
      expect(threads.findMemberThreads).toHaveBeenCalledWith(
        'ch-1',
        'user-1',
        ['ch-chan-1'],
        50,
      );
      expect(threads.findMessagesByIds).toHaveBeenCalledWith(['root-1']);
      expect(result).toEqual([
        expect.objectContaining({
          thread_root_id: 'root-1',
          channel_id: 'ch-chan-1',
          unread_count: 1,
          root: expect.objectContaining({
            id: 'root-1',
            thread_last_reply: expect.objectContaining({ id: 'reply-1' }),
          }),
        }),
      ]);
    });

    it('answers empty without reading threads when no followed channel is readable', async () => {
      channelAccess.filterAccessibleChannelIds.mockResolvedValue(new Set());

      await expect(service.getMemberThreads('ch-1', 'user-1')).resolves.toEqual(
        [],
      );
      expect(threads.findMemberThreads).not.toHaveBeenCalled();
    });

    it('drops a thread whose root is gone or sits in another channel', async () => {
      threads.findMemberThreads.mockResolvedValue([
        row,
        { ...row, thread_root_id: 'gone' },
        { ...row, thread_root_id: 'moved' },
      ]);
      threads.findMessagesByIds.mockResolvedValue([
        root,
        { ...root, id: 'moved', channel_id: 'elsewhere' },
      ]);

      const result = await service.getMemberThreads('ch-1', 'user-1');

      expect(result.map((view) => view.thread_root_id)).toEqual(['root-1']);
    });

    it('masks a blocked member’s root and their latest-reply preview', async () => {
      chatBlocks.listBlockedUserIds.mockResolvedValue(['author-1', 'user-2']);

      const [view] = await service.getMemberThreads('ch-1', 'user-1');

      expect(view.root.content).not.toBe(root.content);
      expect(view.root.thread_last_reply?.content).not.toBe(lastReply.content);
    });
  });
});
