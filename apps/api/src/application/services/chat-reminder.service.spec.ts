import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  ChatReminderService,
  REMINDER_LIST_LIMIT,
  REMINDER_UNAVAILABLE_PREVIEW,
} from './chat-reminder.service';
import { BLOCKED_MESSAGE_CONTENT } from './chat-block-mask';
import type { StoredChatMessageReminder } from '#domain/repositories/chat-message-reminder.repository.interface';
import type { StoredBookmarkedMessage } from '#domain/entities/chat.entity';

const CHAPTER = 'chap-1';
const USER = 'user-1';
const AUTHOR = 'user-2';
const MESSAGE = 'msg-1';
const NOW = new Date('2026-11-14T12:00:00.000Z');
const MINUTE = 60 * 1000;

const message = (
  overrides: Partial<StoredBookmarkedMessage> = {},
): StoredBookmarkedMessage => ({
  id: MESSAGE,
  channel_id: 'ch-1',
  sender_id: AUTHOR,
  author_name: null,
  author_avatar_path: null,
  author_external_id: null,
  content: 'dues are due Friday',
  is_deleted: false,
  thread_root_id: null,
  forwarded_from: null,
  created_at: '2026-11-13T00:00:00.000Z',
  ...overrides,
});

const stored = (
  overrides: Partial<StoredChatMessageReminder> = {},
): StoredChatMessageReminder => ({
  id: 'rem-1',
  user_id: USER,
  message_id: MESSAGE,
  chapter_id: CHAPTER,
  remind_at: new Date(NOW.getTime() + 20 * MINUTE).toISOString(),
  fired_at: null,
  created_at: NOW.toISOString(),
  updated_at: NOW.toISOString(),
  message: message(),
  ...overrides,
});

const READS = {
  channels: [{ id: 'ch-1', name: 'general', type: 'PUBLIC' as const }],
  blockedUserIds: [] as string[],
};

function build() {
  const reminderRepo = {
    upsert: jest.fn().mockImplementation((_u, messageId, _c, remindAt) =>
      Promise.resolve({
        ...stored({ remind_at: remindAt, message_id: messageId }),
        message: undefined,
      }),
    ),
    delete: jest.fn().mockResolvedValue(undefined),
    findByUserAndChapter: jest.fn().mockResolvedValue([]),
    findDue: jest.fn(),
    claimDue: jest.fn(),
  };
  const channelAccess = {
    assertMessageAccess: jest.fn().mockResolvedValue({ id: MESSAGE }),
  };
  const userRepo = {
    findDisplayIdentitiesByIds: jest
      .fn()
      .mockResolvedValue([
        { id: AUTHOR, display_name: 'Alex Author', avatar_url: null },
      ]),
  };
  const service = new ChatReminderService(
    reminderRepo,
    channelAccess as never,
    userRepo as never,
  );
  return { service, reminderRepo, channelAccess, userRepo };
}

describe('ChatReminderService', () => {
  describe('setReminder', () => {
    it('authorizes the message at read, then sets the reminder', async () => {
      const { service, reminderRepo, channelAccess } = build();
      const at = new Date(NOW.getTime() + 60 * MINUTE);

      const ref = await service.setReminder(MESSAGE, CHAPTER, USER, at, NOW);

      expect(channelAccess.assertMessageAccess).toHaveBeenCalledWith(
        MESSAGE,
        CHAPTER,
        USER,
      );
      expect(reminderRepo.upsert).toHaveBeenCalledWith(
        USER,
        MESSAGE,
        CHAPTER,
        at.toISOString(),
      );
      expect(ref).toEqual({
        id: 'rem-1',
        message_id: MESSAGE,
        remind_at: at.toISOString(),
        fired_at: null,
      });
      // Only the four declared fields leave: no user_id.
      expect(Object.keys(ref).sort()).toEqual([
        'fired_at',
        'id',
        'message_id',
        'remind_at',
      ]);
    });

    it('takes a time a minute in the past as now (clock drift)', async () => {
      const { service, reminderRepo } = build();
      await service.setReminder(
        MESSAGE,
        CHAPTER,
        USER,
        new Date(NOW.getTime() - MINUTE),
        NOW,
      );
      expect(reminderRepo.upsert).toHaveBeenCalled();
    });

    it.each([
      ['well in the past', new Date(NOW.getTime() - 10 * MINUTE)],
      [
        'more than a year ahead',
        new Date(NOW.getTime() + 366 * 24 * 60 * MINUTE),
      ],
      ['not a date', new Date('nope')],
    ])('refuses a time %s, before reading the message', async (_label, at) => {
      const { service, reminderRepo, channelAccess } = build();
      await expect(
        service.setReminder(MESSAGE, CHAPTER, USER, at, NOW),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(channelAccess.assertMessageAccess).not.toHaveBeenCalled();
      expect(reminderRepo.upsert).not.toHaveBeenCalled();
    });

    it('sets nothing on a message the caller cannot read', async () => {
      const { service, reminderRepo, channelAccess } = build();
      channelAccess.assertMessageAccess.mockRejectedValue(
        new ForbiddenException(),
      );
      await expect(
        service.setReminder(
          MESSAGE,
          CHAPTER,
          USER,
          new Date(NOW.getTime() + MINUTE),
          NOW,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(reminderRepo.upsert).not.toHaveBeenCalled();
    });
  });

  it('clears the caller’s own reminder without authorizing the message', async () => {
    const { service, reminderRepo, channelAccess } = build();
    await service.clearReminder(MESSAGE, CHAPTER, USER);
    expect(reminderRepo.delete).toHaveBeenCalledWith(USER, MESSAGE, CHAPTER);
    expect(channelAccess.assertMessageAccess).not.toHaveBeenCalled();
  });

  describe('listFor', () => {
    it('reads the caller’s own reminders and names the author', async () => {
      const { service, reminderRepo } = build();
      reminderRepo.findByUserAndChapter.mockResolvedValue([stored()]);

      const rows = await service.listFor(CHAPTER, USER, NOW.getTime(), READS);

      expect(reminderRepo.findByUserAndChapter).toHaveBeenCalledWith(
        USER,
        CHAPTER,
        REMINDER_LIST_LIMIT,
      );
      expect(rows).toEqual([
        expect.objectContaining({
          id: 'rem-1',
          message_id: MESSAGE,
          channel_name: 'general',
          channel_type: 'PUBLIC',
          author_name: 'Alex Author',
          preview: 'dues are due Friday',
          message_available: true,
          due: false,
        }),
      ]);
    });

    it('marks a reminder whose time has come as due', async () => {
      const { service, reminderRepo } = build();
      reminderRepo.findByUserAndChapter.mockResolvedValue([
        stored({
          remind_at: new Date(NOW.getTime() - MINUTE).toISOString(),
          fired_at: NOW.toISOString(),
        }),
      ]);
      const [row] = await service.listFor(CHAPTER, USER, NOW.getTime(), READS);
      expect(row.due).toBe(true);
    });

    it('redacts a reminder in a channel the caller can no longer read, and keeps it so they can clear it', async () => {
      const { service, reminderRepo } = build();
      reminderRepo.findByUserAndChapter.mockResolvedValue([
        stored({ message: message({ channel_id: 'ch-lost' }) }),
      ]);
      const [row] = await service.listFor(CHAPTER, USER, NOW.getTime(), READS);
      expect(row).toEqual(
        expect.objectContaining({
          message_available: false,
          preview: REMINDER_UNAVAILABLE_PREVIEW,
          author_name: '',
          channel_name: null,
          channel_type: null,
          thread_root_id: null,
        }),
      );
    });

    it('masks a blocked author’s message as the timeline does', async () => {
      const { service, reminderRepo } = build();
      reminderRepo.findByUserAndChapter.mockResolvedValue([stored()]);
      const [row] = await service.listFor(CHAPTER, USER, NOW.getTime(), {
        ...READS,
        blockedUserIds: [AUTHOR],
      });
      expect(row.preview).toBe(BLOCKED_MESSAGE_CONTENT);
      expect(row.author_name).toBe('');
      expect(row.message_available).toBe(true);
    });

    it('reads no names when there are no reminders', async () => {
      const { service, userRepo } = build();
      expect(
        await service.listFor(CHAPTER, USER, NOW.getTime(), READS),
      ).toEqual([]);
      expect(userRepo.findDisplayIdentitiesByIds).not.toHaveBeenCalled();
    });
  });
});
