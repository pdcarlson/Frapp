import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ChatBookmarkService } from './chat-bookmark.service';
import { ChannelAccessService } from './channel-access.service';
import { CHAT_MESSAGE_BOOKMARK_REPOSITORY } from '../../domain/repositories/chat.repository.interface';
import type { IChatMessageBookmarkRepository } from '../../domain/repositories/chat.repository.interface';
import type {
  ChatMessage,
  ChatMessageBookmark,
  ChatMessageBookmarkWithMessage,
} from '../../domain/entities/chat.entity';

const CHAPTER = 'chap-1';
const USER = 'user-1';
const MESSAGE = 'msg-1';

const message = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  id: MESSAGE,
  channel_id: 'ch-1',
  sender_id: 'user-2',
  content: 'keep this',
  type: 'TEXT',
  reply_to_id: null,
  metadata: {},
  is_pinned: false,
  pinned_at: null,
  edited_at: null,
  is_deleted: false,
  created_at: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const bookmark: ChatMessageBookmark = {
  id: 'bm-1',
  user_id: USER,
  message_id: MESSAGE,
  chapter_id: CHAPTER,
  created_at: '2026-01-02T00:00:00.000Z',
};

describe('ChatBookmarkService', () => {
  let service: ChatBookmarkService;
  let mockRepo: jest.Mocked<IChatMessageBookmarkRepository>;
  let mockChannelAccess: { assertMessageAccess: jest.Mock };

  beforeEach(async () => {
    mockRepo = {
      create: jest.fn().mockResolvedValue(bookmark),
      delete: jest.fn().mockResolvedValue(undefined),
      findOne: jest.fn().mockResolvedValue(null),
      findByUserAndChapter: jest.fn().mockResolvedValue([]),
    };
    mockChannelAccess = {
      assertMessageAccess: jest.fn().mockResolvedValue(message()),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        ChatBookmarkService,
        { provide: CHAT_MESSAGE_BOOKMARK_REPOSITORY, useValue: mockRepo },
        { provide: ChannelAccessService, useValue: mockChannelAccess },
      ],
    }).compile();

    service = moduleRef.get(ChatBookmarkService);
  });

  describe('bookmarkMessage', () => {
    it('authorizes the message before writing anything', async () => {
      await service.bookmarkMessage(MESSAGE, CHAPTER, USER);

      expect(mockChannelAccess.assertMessageAccess).toHaveBeenCalledWith(
        MESSAGE,
        CHAPTER,
        USER,
      );
    });

    it('authorizes at read, not post, so a read-only channel is bookmarkable', async () => {
      // #announcements is `is_read_only`, so a `'post'` operation would deny it
      // — and an announcement is exactly the kind of message a member wants to
      // keep. A bookmark authors nothing in the channel, so `'read'` is the
      // correct gate. The default is asserted rather than assumed: a later
      // edit passing `'post'` here would silently remove announcements,
      // read-only channels and every alumni-restricted channel from the
      // feature, and no other test would notice.
      await service.bookmarkMessage(MESSAGE, CHAPTER, USER);

      const call = mockChannelAccess.assertMessageAccess.mock.calls[0];
      expect(call[3]).toBeUndefined();
    });

    it('does not write when the caller cannot see the message', async () => {
      mockChannelAccess.assertMessageAccess.mockRejectedValue(
        new ForbiddenException(),
      );

      await expect(
        service.bookmarkMessage(MESSAGE, CHAPTER, USER),
      ).rejects.toThrow(ForbiddenException);
      expect(mockRepo.create).not.toHaveBeenCalled();
    });

    it('files the bookmark under the caller own user id, never a supplied one', async () => {
      await service.bookmarkMessage(MESSAGE, CHAPTER, USER);

      expect(mockRepo.create).toHaveBeenCalledWith(USER, MESSAGE, CHAPTER);
    });
  });

  describe('unbookmarkMessage', () => {
    it('authorizes the message first, so the route is not an existence oracle', async () => {
      // Deleting only ever touches the caller's own row, so it is tempting to
      // skip the access check. That would make this route answer "does this
      // message id exist?" for any uuid a caller cared to try, distinguishing
      // 404 from 204. Authorizing first collapses both to 404.
      mockChannelAccess.assertMessageAccess.mockRejectedValue(
        new NotFoundException('Message not found'),
      );

      await expect(
        service.unbookmarkMessage(MESSAGE, CHAPTER, USER),
      ).rejects.toThrow(NotFoundException);
      expect(mockRepo.delete).not.toHaveBeenCalled();
    });

    it('succeeds when there was no bookmark to remove', async () => {
      await expect(
        service.unbookmarkMessage(MESSAGE, CHAPTER, USER),
      ).resolves.toBeUndefined();
      expect(mockRepo.delete).toHaveBeenCalledWith(USER, MESSAGE);
    });
  });

  describe('listBookmarks', () => {
    it('asks only for the caller own bookmarks in this chapter', async () => {
      await service.listBookmarks(CHAPTER, USER);

      expect(mockRepo.findByUserAndChapter).toHaveBeenCalledWith(USER, CHAPTER);
    });

    it('passes deleted-message bookmarks through untouched', async () => {
      // The spec requires the placeholder to survive: "If the original message
      // is deleted, the bookmark surfaces a '[message deleted]' placeholder
      // rather than disappearing." `deleteMessage` already rewrites the
      // message's own content to that string, so the service must not filter —
      // and a filter added here would defeat the repository-level guarantee
      // even though that query stayed correct.
      const deleted: ChatMessageBookmarkWithMessage = {
        ...bookmark,
        message: message({ content: '[message deleted]', is_deleted: true }),
      };
      mockRepo.findByUserAndChapter.mockResolvedValue([deleted]);

      const rows = await service.listBookmarks(CHAPTER, USER);

      expect(rows).toHaveLength(1);
      expect(rows[0].message.content).toBe('[message deleted]');
    });

    it('does not re-authorize channels on read, so leaving a channel does not erase bookmarks', async () => {
      // Characterisation of a deliberate choice, not an oversight. Re-filtering
      // by current channel access would silently drop a member's saved messages
      // when they leave a private channel — data loss dressed as a protection.
      // Every row was authorized when it was created.
      mockRepo.findByUserAndChapter.mockResolvedValue([
        { ...bookmark, message: message() },
      ]);

      await service.listBookmarks(CHAPTER, USER);

      expect(mockChannelAccess.assertMessageAccess).not.toHaveBeenCalled();
    });
  });
});
