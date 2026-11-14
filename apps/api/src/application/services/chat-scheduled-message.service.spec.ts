import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  ChatScheduledMessageService,
  SCHEDULE_MAX_ATTEMPTS,
  SCHEDULE_MAX_PENDING,
} from './chat-scheduled-message.service';
import type { ChatScheduledMessage } from '#domain/entities/chat-scheduled-message.entity';
import type { IChatScheduledMessageRepository } from '#domain/repositories/chat-scheduled-message.repository.interface';
import type {
  IChatChannelRepository,
  IChatMessageRepository,
} from '#domain/repositories/chat.repository.interface';
import type { IChapterRepository } from '#domain/repositories/chapter.repository.interface';
import type { ChannelAccessService } from './channel-access.service';
import type { ChatService } from './chat.service';
import type { NotificationService } from './notification.service';

const NOW = Date.parse('2026-11-14T13:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const row = (
  over: Partial<ChatScheduledMessage> = {},
): ChatScheduledMessage => ({
  id: 'sched-1',
  chapter_id: 'ch-1',
  channel_id: 'chan-1',
  user_id: 'u-1',
  member_id: 'm-1',
  content: 'Chapter at 8',
  mention_picks: null,
  send_at: new Date(NOW - 1000).toISOString(),
  status: 'pending',
  failure_reason: null,
  attempts: 1,
  lease_until: null,
  created_at: '2026-11-13T20:00:00.000Z',
  updated_at: '2026-11-13T20:00:00.000Z',
  ...over,
});

describe('ChatScheduledMessageService', () => {
  let repo: jest.Mocked<IChatScheduledMessageRepository>;
  let channelRepo: { findById: jest.Mock };
  let access: { assertChannelAccess: jest.Mock };
  let chat: { sendMessage: jest.Mock };
  let notifications: { notifyUser: jest.Mock };
  let messageRepo: { findByClientMessageId: jest.Mock };
  let chapterRepo: { findById: jest.Mock };
  let service: ChatScheduledMessageService;

  beforeEach(() => {
    repo = {
      listForAuthor: jest.fn().mockResolvedValue([]),
      findForAuthor: jest.fn(),
      create: jest.fn(async (input) => row({ ...input, id: 'new' })),
      updateForAuthor: jest.fn(async (_c, _u, id, patch, _now) =>
        row({ id, ...patch }),
      ),
      countPending: jest.fn().mockResolvedValue(0),
      deleteForAuthor: jest.fn().mockResolvedValue('deleted'),
      findDue: jest.fn(),
      claim: jest.fn(async (r, _lease: string, _now: string, _due?: string) =>
        row({ ...r, attempts: r.attempts + 1 }),
      ),
      removeSent: jest.fn().mockResolvedValue(undefined),
      markFailed: jest.fn().mockResolvedValue(undefined),
    };
    channelRepo = {
      findById: jest
        .fn()
        .mockResolvedValue({ name: 'general', type: 'PUBLIC' }),
    };
    access = { assertChannelAccess: jest.fn().mockResolvedValue({}) };
    chat = {
      sendMessage: jest
        .fn()
        .mockResolvedValue({ message: { id: 'msg-1' }, deduplicated: false }),
    };
    notifications = { notifyUser: jest.fn().mockResolvedValue(undefined) };
    messageRepo = { findByClientMessageId: jest.fn().mockResolvedValue(null) };
    chapterRepo = {
      findById: jest.fn().mockResolvedValue({
        subscription_status: 'active',
        past_due_since: null,
      }),
    };
    service = new ChatScheduledMessageService(
      repo,
      channelRepo as unknown as IChatChannelRepository,
      messageRepo as unknown as IChatMessageRepository,
      chapterRepo as unknown as IChapterRepository,
      access as unknown as ChannelAccessService,
      chat as unknown as ChatService,
      notifications as unknown as NotificationService,
    );
  });

  describe('schedule', () => {
    const input = (sendAt: number, content = 'Chapter at 8') => ({
      channel_id: 'chan-1',
      content,
      send_at: new Date(sendAt).toISOString(),
    });

    it('checks the author may post there now, and stores the instant', async () => {
      await service.schedule('ch-1', 'u-1', 'm-1', input(NOW + DAY), NOW);
      expect(access.assertChannelAccess).toHaveBeenCalledWith(
        'chan-1',
        'ch-1',
        'u-1',
        'post',
      );
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          chapter_id: 'ch-1',
          user_id: 'u-1',
          send_at: new Date(NOW + DAY).toISOString(),
        }),
      );
    });

    it('normalizes a time given with a zone offset to the same instant', async () => {
      // 8 AM in New York on Nov 15 is 13:00 UTC.
      await service.schedule(
        'ch-1',
        'u-1',
        'm-1',
        {
          channel_id: 'chan-1',
          content: 'x',
          send_at: '2026-11-15T08:00:00-05:00',
        },
        NOW,
      );
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ send_at: '2026-11-15T13:00:00.000Z' }),
      );
    });

    it('refuses a time in the past, beyond a minute’s grace', async () => {
      await expect(
        service.schedule('ch-1', 'u-1', 'm-1', input(NOW - 2 * 60 * 1000), NOW),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.schedule('ch-1', 'u-1', 'm-1', input(NOW - 30 * 1000), NOW),
      ).resolves.toBeDefined();
    });

    it('refuses more than 120 days ahead', async () => {
      await expect(
        service.schedule('ch-1', 'u-1', 'm-1', input(NOW + 121 * DAY), NOW),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses empty text', async () => {
      await expect(
        service.schedule('ch-1', 'u-1', 'm-1', input(NOW + DAY, ' ￼ '), NOW),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses when the author cannot post there', async () => {
      access.assertChannelAccess.mockRejectedValue(new ForbiddenException());
      await expect(
        service.schedule('ch-1', 'u-1', 'm-1', input(NOW + DAY), NOW),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('caps the pending messages one member holds', async () => {
      repo.countPending.mockResolvedValue(SCHEDULE_MAX_PENDING);
      await expect(
        service.schedule('ch-1', 'u-1', 'm-1', input(NOW + DAY), NOW),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('update', () => {
    it('changes the text and drops the old picks', async () => {
      repo.findForAuthor.mockResolvedValue(
        row({ mention_picks: [{ user_id: 'u-2', label: 'Sam' }] }),
      );
      await service.update('ch-1', 'u-1', 'sched-1', { content: 'New' }, NOW);
      expect(repo.updateForAuthor).toHaveBeenCalledWith(
        'ch-1',
        'u-1',
        'sched-1',
        { content: 'New', mention_picks: null },
        new Date(NOW).toISOString(),
      );
    });

    it('puts a failed message back in line at once when no time is given', async () => {
      repo.findForAuthor.mockResolvedValue(
        row({
          status: 'failed',
          failure_reason: 'no_access',
          send_at: new Date(NOW - DAY).toISOString(),
        }),
      );
      await service.update('ch-1', 'u-1', 'sched-1', { content: 'Again' }, NOW);
      expect(repo.updateForAuthor.mock.calls[0][3]).toMatchObject({
        send_at: new Date(NOW).toISOString(),
      });
      expect(access.assertChannelAccess).toHaveBeenCalled();
    });

    it('is a 404 for a row that is not the caller’s', async () => {
      repo.findForAuthor.mockResolvedValue(null);
      await expect(
        service.update('ch-1', 'u-1', 'sched-1', { content: 'x' }, NOW),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('is a 409 while a send holds it', async () => {
      repo.findForAuthor.mockResolvedValue(row());
      repo.updateForAuthor.mockResolvedValue(null);
      await expect(
        service.update('ch-1', 'u-1', 'sched-1', { content: 'x' }, NOW),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  it('remove is a 404 when there was nothing to delete', async () => {
    repo.deleteForAuthor.mockResolvedValue('missing');
    await expect(service.remove('ch-1', 'u-1', 'x')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('remove is a 409 while a send holds it, since it may already be posting', async () => {
    repo.deleteForAuthor.mockResolvedValue('held');
    await expect(service.remove('ch-1', 'u-1', 'x')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('refuses a time with no offset, which the server would read on its own clock', async () => {
    for (const sendAt of ['2026-11-16T08:00:00', '2026-11-16']) {
      await expect(
        service.schedule(
          'ch-1',
          'u-1',
          'm-1',
          { channel_id: 'chan-1', content: 'x', send_at: sendAt },
          NOW,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it('update refuses null text with a 400', async () => {
    await expect(
      service.update('ch-1', 'u-1', 'sched-1', { content: null }, NOW),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('update refuses a row whose message already posted', async () => {
    repo.findForAuthor.mockResolvedValue(row({ attempts: 1 }));
    messageRepo.findByClientMessageId.mockResolvedValue({ id: 'msg-1' });
    await expect(
      service.update('ch-1', 'u-1', 'sched-1', { content: 'x' }, NOW),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repo.updateForAuthor).not.toHaveBeenCalled();
  });

  describe('deliver', () => {
    it('posts as the author with the row id as client_message_id, then deletes the row', async () => {
      const picks = [{ user_id: 'u-2', label: 'Sam' }];
      const result = await service.deliver(row({ mention_picks: picks }));
      expect(result).toEqual({ outcome: 'sent', message: { id: 'msg-1' } });
      expect(chat.sendMessage).toHaveBeenCalledWith({
        chapter_id: 'ch-1',
        channel_id: 'chan-1',
        sender_id: 'u-1',
        content: 'Chapter at 8',
        client_message_id: 'sched-1',
        mention_picks: picks,
        enabled_modules: null,
      });
      expect(repo.removeSent).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'sched-1', chapter_id: 'ch-1' }),
      );
    });

    it('answers an earlier send that posted, without sending or judging again', async () => {
      messageRepo.findByClientMessageId.mockResolvedValue({ id: 'msg-0' });
      chat.sendMessage.mockRejectedValue(new ForbiddenException());
      await expect(service.deliver(row({ attempts: 2 }))).resolves.toEqual({
        outcome: 'sent',
        message: { id: 'msg-0' },
      });
      expect(chat.sendMessage).not.toHaveBeenCalled();
      expect(repo.removeSent).toHaveBeenCalled();
      expect(notifications.notifyUser).not.toHaveBeenCalled();
    });

    it.each([
      ['canceled', null],
      ['past_due', '2026-11-01T00:00:00.000Z'],
    ])(
      'does not post into a chapter read-only for billing (%s)',
      async (status, since) => {
        chapterRepo.findById.mockResolvedValue({
          subscription_status: status,
          past_due_since: since,
        });
        await expect(service.deliver(row())).resolves.toMatchObject({
          outcome: 'failed',
          reason: 'chapter_locked',
        });
        expect(chat.sendMessage).not.toHaveBeenCalled();
        expect(repo.markFailed).toHaveBeenCalledWith(
          expect.anything(),
          'chapter_locked',
        );
      },
    );

    it('marks it failed and tells the author when they lost access to post', async () => {
      chat.sendMessage.mockRejectedValue(new ForbiddenException());
      const result = await service.deliver(row());
      expect(result).toMatchObject({ outcome: 'failed', reason: 'no_access' });
      expect(repo.markFailed).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'sched-1' }),
        'no_access',
      );
      expect(repo.removeSent).not.toHaveBeenCalled();
      expect(notifications.notifyUser).toHaveBeenCalledWith(
        'u-1',
        'ch-1',
        expect.objectContaining({
          title: 'Scheduled message not sent',
          body: expect.not.stringContaining('#general'),
          data: { target: { screen: 'chat', channelId: 'chan-1' } },
        }),
      );
    });

    it('names the channel only where the author can still see it', async () => {
      chat.sendMessage.mockRejectedValue(new BadRequestException());
      await service.deliver(row());
      expect(notifications.notifyUser.mock.calls[0][2].body).toContain(
        '#general',
      );
      channelRepo.findById.mockResolvedValue({ name: 'dm', type: 'DM' });
      await service.deliver(row());
      expect(notifications.notifyUser.mock.calls[1][2].body).toContain(
        'a conversation',
      );
    });

    it('marks any other refusal not_sendable', async () => {
      chat.sendMessage.mockRejectedValue(new BadRequestException());
      await expect(service.deliver(row())).resolves.toMatchObject({
        outcome: 'failed',
        reason: 'not_sendable',
      });
    });

    it('still marks it failed when the notice cannot be sent', async () => {
      chat.sendMessage.mockRejectedValue(new ForbiddenException());
      notifications.notifyUser.mockRejectedValue(new Error('down'));
      await expect(service.deliver(row())).resolves.toMatchObject({
        outcome: 'failed',
      });
      expect(repo.markFailed).toHaveBeenCalled();
    });

    it('leaves a row that broke on the way for another try', async () => {
      chat.sendMessage.mockRejectedValue(new Error('socket hang up'));
      await expect(
        service.deliver(row({ attempts: 1 })),
      ).resolves.toMatchObject({
        outcome: 'retry',
      });
      expect(repo.markFailed).not.toHaveBeenCalled();
    });

    it('gives up after the last try', async () => {
      chat.sendMessage.mockRejectedValue(new Error('socket hang up'));
      await expect(
        service.deliver(row({ attempts: SCHEDULE_MAX_ATTEMPTS })),
      ).resolves.toMatchObject({ outcome: 'failed', reason: 'send_failed' });
      expect(notifications.notifyUser).toHaveBeenCalled();
    });
  });

  describe('sendNow', () => {
    it('claims the row and posts it', async () => {
      repo.findForAuthor.mockResolvedValue(
        row({ attempts: 0, send_at: new Date(NOW + DAY).toISOString() }),
      );
      await expect(
        service.sendNow('ch-1', 'u-1', 'sched-1', NOW),
      ).resolves.toEqual({
        id: 'msg-1',
      });
      expect(repo.claim).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'sched-1', attempts: 0 }),
        new Date(NOW + 2 * 60 * 1000).toISOString(),
        new Date(NOW).toISOString(),
      );
    });

    it('is a 409 when the sweep already holds it', async () => {
      repo.findForAuthor.mockResolvedValue(row());
      repo.claim.mockResolvedValue(null);
      await expect(
        service.sendNow('ch-1', 'u-1', 'sched-1', NOW),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(chat.sendMessage).not.toHaveBeenCalled();
    });

    it('answers with the refusal when the author can no longer post', async () => {
      repo.findForAuthor.mockResolvedValue(row());
      chat.sendMessage.mockRejectedValue(new ForbiddenException());
      await expect(
        service.sendNow('ch-1', 'u-1', 'sched-1', NOW),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.markFailed).toHaveBeenCalled();
    });

    it('refuses a failed row: it is edited to go again', async () => {
      repo.findForAuthor.mockResolvedValue(
        row({ status: 'failed', failure_reason: 'no_access' }),
      );
      await expect(
        service.sendNow('ch-1', 'u-1', 'sched-1', NOW),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
