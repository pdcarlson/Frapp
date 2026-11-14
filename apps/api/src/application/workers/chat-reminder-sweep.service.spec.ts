import { ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  ChatReminderSweepService,
  REMINDER_NOTIFICATION_CATEGORY,
  REMINDER_SWEEP_BATCH,
} from './chat-reminder-sweep.service';
import * as caughtFailure from '../../infrastructure/observability/report-caught-failure';
import type { StoredChatMessageReminder } from '#domain/repositories/chat-message-reminder.repository.interface';
import type { StoredBookmarkedMessage } from '#domain/entities/chat.entity';

const NOW = Date.parse('2026-11-14T12:00:00.000Z');
const AT = new Date(NOW).toISOString();

const message = (
  overrides: Partial<StoredBookmarkedMessage> = {},
): StoredBookmarkedMessage => ({
  id: 'msg-1',
  channel_id: 'ch-1',
  sender_id: 'author',
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

const reminder = (
  overrides: Partial<StoredChatMessageReminder> = {},
): StoredChatMessageReminder => ({
  id: 'rem-1',
  user_id: 'member',
  message_id: 'msg-1',
  chapter_id: 'chap-1',
  remind_at: '2026-11-14T11:59:00.000Z',
  fired_at: null,
  created_at: '2026-11-14T11:00:00.000Z',
  updated_at: '2026-11-14T11:00:00.000Z',
  message: message(),
  ...overrides,
});

function build(due: StoredChatMessageReminder[] = [reminder()]) {
  const reminderRepo = {
    upsert: jest.fn(),
    delete: jest.fn(),
    findByUserAndChapter: jest.fn(),
    findDue: jest.fn().mockResolvedValue(due),
    claimDue: jest.fn().mockResolvedValue(true),
  };
  const channelAccess = {
    assertChannelAccess: jest
      .fn()
      .mockResolvedValue({ id: 'ch-1', name: 'general' }),
  };
  const chatBlocks = { listBlockedUserIds: jest.fn().mockResolvedValue([]) };
  const notificationService = {
    notifyUser: jest.fn().mockResolvedValue(undefined),
  };
  const sweep = new ChatReminderSweepService(
    reminderRepo,
    channelAccess as never,
    chatBlocks as never,
    notificationService as never,
  );
  return {
    sweep,
    reminderRepo,
    channelAccess,
    chatBlocks,
    notificationService,
  };
}

describe('ChatReminderSweepService', () => {
  it('claims each due reminder at the time it read, then pushes it to its member', async () => {
    const { sweep, reminderRepo, channelAccess, notificationService } = build();

    expect(await sweep.sweep(NOW)).toEqual({ fired: 1, pushed: 1 });

    expect(reminderRepo.findDue).toHaveBeenCalledWith(AT, REMINDER_SWEEP_BATCH);
    expect(reminderRepo.claimDue).toHaveBeenCalledWith(reminder(), AT);
    expect(channelAccess.assertChannelAccess).toHaveBeenCalledWith(
      'ch-1',
      'chap-1',
      'member',
      'read',
    );
    expect(notificationService.notifyUser).toHaveBeenCalledWith(
      'member',
      'chap-1',
      {
        title: 'Reminder',
        body: 'dues are due Friday',
        category: REMINDER_NOTIFICATION_CATEGORY,
        data: {
          target: { screen: 'chat', channelId: 'ch-1' },
          reminder: true,
        },
        chatMessageId: 'msg-1',
      },
    );
  });

  it('opens a thread reply’s thread', async () => {
    const { sweep, notificationService } = build([
      reminder({ message: message({ thread_root_id: 'root-1' }) }),
    ]);
    await sweep.sweep(NOW);
    expect(notificationService.notifyUser.mock.calls[0][2].data.target).toEqual(
      { screen: 'chat', channelId: 'ch-1', threadRootId: 'root-1' },
    );
  });

  it('sends nothing for a reminder another replica claimed first', async () => {
    const { sweep, reminderRepo, notificationService } = build();
    reminderRepo.claimDue.mockResolvedValue(false);

    expect(await sweep.sweep(NOW)).toEqual({ fired: 0, pushed: 0 });
    expect(notificationService.notifyUser).not.toHaveBeenCalled();
  });

  it.each([new ForbiddenException(), new NotFoundException()])(
    'fires without a push when the member can no longer read the channel (%p)',
    async (refusal) => {
      const { sweep, channelAccess, notificationService } = build();
      channelAccess.assertChannelAccess.mockRejectedValue(refusal);

      expect(await sweep.sweep(NOW)).toEqual({ fired: 1, pushed: 0 });
      expect(notificationService.notifyUser).not.toHaveBeenCalled();
    },
  );

  it('does not quote a blocked author', async () => {
    const { sweep, chatBlocks, notificationService } = build();
    chatBlocks.listBlockedUserIds.mockResolvedValue(['author']);
    await sweep.sweep(NOW);
    expect(notificationService.notifyUser.mock.calls[0][2].body).toBe(
      'You asked to be reminded about a message',
    );
  });

  it('says a deleted message was deleted rather than quoting its placeholder', async () => {
    const { sweep, notificationService } = build([
      reminder({
        message: message({ is_deleted: true, content: '[message deleted]' }),
      }),
    ]);
    await sweep.sweep(NOW);
    expect(notificationService.notifyUser.mock.calls[0][2].body).toBe(
      'The message you asked about was deleted',
    );
  });

  it('reports a failed push and carries on with the next reminder', async () => {
    const reported = jest
      .spyOn(caughtFailure, 'reportCaughtFailure')
      .mockImplementation(() => undefined);
    const { sweep, notificationService } = build([
      reminder(),
      reminder({ id: 'rem-2', message_id: 'msg-2' }),
    ]);
    notificationService.notifyUser
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce(undefined);

    expect(await sweep.sweep(NOW)).toEqual({ fired: 2, pushed: 1 });
    expect(reported).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ site: 'chat-reminder-push' }),
    );
    reported.mockRestore();
  });

  it('runs one tick at a time on a replica', async () => {
    const { sweep, reminderRepo } = build([]);
    let release!: () => void;
    reminderRepo.findDue.mockReturnValue(
      new Promise((resolve) => {
        release = () => resolve([]);
      }),
    );
    const first = sweep.handleReminderSweep();
    await sweep.handleReminderSweep();
    release();
    await first;
    expect(reminderRepo.findDue).toHaveBeenCalledTimes(1);
  });
});
