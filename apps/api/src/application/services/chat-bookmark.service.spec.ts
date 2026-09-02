import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  BOOKMARK_REDACTED_CONTENT,
  ChatBookmarkService,
} from './chat-bookmark.service';
import { ChannelAccessService } from './channel-access.service';
import { CHAT_MESSAGE_BOOKMARK_REPOSITORY } from '../../domain/repositories/chat.repository.interface';
import type { IChatMessageBookmarkRepository } from '../../domain/repositories/chat.repository.interface';
import type {
  BookmarkedMessage,
  ChatMessageBookmarkRef,
  ChatMessageBookmarkWithMessage,
} from '../../domain/entities/chat.entity';

const CHAPTER = 'chap-1';
const USER = 'user-1';
const MESSAGE = 'msg-1';

const message = (
  overrides: Partial<BookmarkedMessage> = {},
): BookmarkedMessage => ({
  // Exactly the nine fields the endpoint serves. A wider fixture would let a
  // test assert redaction of a field production never sends.
  id: MESSAGE,
  channel_id: 'ch-1',
  sender_id: 'user-2',
  author_name: null,
  author_avatar_path: null,
  author_external_id: null,
  content: 'keep this',
  is_deleted: false,
  created_at: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const bookmark: ChatMessageBookmarkRef = {
  id: 'bm-1',
  message_id: MESSAGE,
  chapter_id: CHAPTER,
  created_at: '2026-01-02T00:00:00.000Z',
};

describe('ChatBookmarkService', () => {
  let service: ChatBookmarkService;
  let mockRepo: jest.Mocked<IChatMessageBookmarkRepository>;
  let mockChannelAccess: {
    assertMessageAccess: jest.Mock;
    filterAccessibleChannelIds: jest.Mock;
  };

  beforeEach(async () => {
    mockRepo = {
      create: jest.fn().mockResolvedValue(bookmark),
      delete: jest.fn().mockResolvedValue(undefined),
      findByUserAndChapter: jest.fn().mockResolvedValue([]),
    };
    mockChannelAccess = {
      assertMessageAccess: jest.fn().mockResolvedValue(message()),
      // Default: every channel the fixtures use is readable.
      filterAccessibleChannelIds: jest
        .fn()
        .mockImplementation((_c: string, _u: string, ids: string[]) =>
          Promise.resolve(new Set(ids)),
        ),
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
    it('does NOT authorize the message, so a lost-access bookmark stays removable', async () => {
      // The regression this pins. An earlier cut authorized the message here on
      // anti-oracle grounds, which meant that the moment a member rotated off a
      // ROLE_GATED channel, DELETE on their own bookmark answered 403 — leaving
      // a row they could see, could not read, could not jump to, and could not
      // remove by any path in the API or the UI. A member must always be able to
      // delete their own row.
      mockChannelAccess.assertMessageAccess.mockRejectedValue(
        new ForbiddenException(),
      );

      await expect(
        service.unbookmarkMessage(MESSAGE, CHAPTER, USER),
      ).resolves.toBeUndefined();
      expect(mockChannelAccess.assertMessageAccess).not.toHaveBeenCalled();
      expect(mockRepo.delete).toHaveBeenCalledWith(USER, MESSAGE, CHAPTER);
    });

    it('scopes the delete by chapter as well as user and message', async () => {
      // The pair (user_id, message_id) is already globally unique, so the
      // chapter predicate looks redundant — and is exactly what stops this from
      // reaching across chapters if a future caller drops the authorization the
      // bookmark path no longer performs.
      await service.unbookmarkMessage(MESSAGE, CHAPTER, USER);

      expect(mockRepo.delete).toHaveBeenCalledWith(USER, MESSAGE, CHAPTER);
    });

    it('succeeds when there was no bookmark to remove', async () => {
      await expect(
        service.unbookmarkMessage(MESSAGE, CHAPTER, USER),
      ).resolves.toBeUndefined();
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
        message_available: true,
        message: message({ content: '[message deleted]', is_deleted: true }),
      };
      mockRepo.findByUserAndChapter.mockResolvedValue([deleted]);

      const rows = await service.listBookmarks(CHAPTER, USER);

      expect(rows).toHaveLength(1);
      expect(rows[0].message.content).toBe('[message deleted]');
    });

    it('keeps the row but redacts the message when the channel is no longer readable', async () => {
      // The leak `/diff-review` caught. The embed re-reads chat_messages on
      // every request, so this list served the message's CURRENT content — a
      // member who lost access kept receiving edits made after they lost it.
      // Redacting rather than dropping the row keeps the member able to see and
      // remove their own bookmark.
      mockRepo.findByUserAndChapter.mockResolvedValue([
        { ...bookmark, message: message({ content: 'secret bank details' }) },
      ]);
      mockChannelAccess.filterAccessibleChannelIds.mockResolvedValue(new Set());

      const rows = await service.listBookmarks(CHAPTER, USER);

      expect(rows).toHaveLength(1);
      expect(rows[0].message_available).toBe(false);
      expect(rows[0].message.content).not.toContain('secret');
      expect(rows[0].message.content).toBe(BOOKMARK_REDACTED_CONTENT);
    });

    it('never serves the fields that would leak post-revocation activity', async () => {
      // Stronger than redacting them: pin state, edits, payload, mentions and
      // metadata are not in the endpoint's projection at all, so there is no
      // value to get wrong. This asserts the redacted row is exactly the
      // nine-field shape rather than a wider object with blanks in it — a
      // redacted row that differed structurally from an available one would be
      // the same "carries fields its declared shape omits" problem inverted.
      mockRepo.findByUserAndChapter.mockResolvedValue([
        { ...bookmark, message_available: true, message: message() },
      ]);
      mockChannelAccess.filterAccessibleChannelIds.mockResolvedValue(new Set());

      const [row] = await service.listBookmarks(CHAPTER, USER);

      expect(Object.keys(row.message).sort()).toEqual([
        'author_avatar_path',
        'author_external_id',
        'author_name',
        'channel_id',
        'content',
        'created_at',
        'id',
        'is_deleted',
        'sender_id',
      ]);
    });

    it('treats an archived Group DM as still readable', async () => {
      // #348: archiving freezes posting, not reading — a remaining member can
      // still open the channel. `filterAccessibleChannelIds` excludes archived
      // channels by default because its other callers want the ACTIVE list, so
      // taking that default here would redact messages the member can still
      // read in the timeline.
      mockRepo.findByUserAndChapter.mockResolvedValue([
        { ...bookmark, message: message() },
      ]);

      await service.listBookmarks(CHAPTER, USER);

      expect(mockChannelAccess.filterAccessibleChannelIds).toHaveBeenCalledWith(
        CHAPTER,
        USER,
        ['ch-1'],
        { includeArchived: true },
      );
    });

    it('resolves each distinct channel once, not once per bookmark', async () => {
      mockRepo.findByUserAndChapter.mockResolvedValue([
        { ...bookmark, id: 'bm-1', message: message() },
        { ...bookmark, id: 'bm-2', message: message({ id: 'msg-2' }) },
        { ...bookmark, id: 'bm-3', message: message({ id: 'msg-3' }) },
      ]);

      await service.listBookmarks(CHAPTER, USER);

      const ids = mockChannelAccess.filterAccessibleChannelIds.mock
        .calls[0][2] as string[];
      expect(ids).toEqual(['ch-1']);
    });

    it('does not call the access predicate at all when there are no bookmarks', async () => {
      await service.listBookmarks(CHAPTER, USER);

      expect(
        mockChannelAccess.filterAccessibleChannelIds,
      ).not.toHaveBeenCalled();
    });
  });
});
