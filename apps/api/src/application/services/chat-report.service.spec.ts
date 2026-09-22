import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  ChatReportService,
  REPORT_FILED_NOTIFICATION,
  REPORT_QUEUE_PERMISSIONS,
} from './chat-report.service';
import {
  ChannelAccessService,
  ReportedMessageGrant,
} from './channel-access.service';
import { ChatService } from './chat.service';
import { NotificationService } from './notification.service';
import { RbacService } from './rbac.service';
import { SystemPermissions } from '#domain/constants/permissions';
import { CHAT_MESSAGE_REPORT_REPOSITORY } from '#domain/repositories/chat-moderation.repository.interface';
import type { IChatMessageReportRepository } from '#domain/repositories/chat-moderation.repository.interface';
import type { ChatMessage } from '#domain/entities/chat.entity';
import type { ChatMessageReportView } from '#domain/entities/chat-moderation.entity';

/**
 * `spec/behavior/chat/README.md` § Report and block, as tests.
 *
 * Four properties are load-bearing and each has its own case below: reporting is
 * authorized as a **read** of the message's channel (so it reaches exactly the
 * messages the member could already render, and no more); the reporter is the
 * authenticated caller and nothing else; the evidence is **snapshotted** at file
 * time, both author columns; and every query is scoped to the caller's chapter.
 */
describe('ChatReportService', () => {
  const CHAPTER = 'chapter-1';
  const REPORTER = 'user-reporter';
  const OFFICER = 'user-officer';
  const MESSAGE_ID = 'msg-1';

  const baseMessage: ChatMessage = {
    id: MESSAGE_ID,
    channel_id: 'chan-1',
    sender_id: 'user-abuser',
    content: 'go away',
    type: 'TEXT',
    reply_to_id: null,
    metadata: {},
    is_pinned: false,
    pinned_at: null,
    edited_at: null,
    is_deleted: false,
    created_at: '2026-03-01T00:00:00.000Z',
  };

  const baseReport: ChatMessageReportView = {
    id: 'report-1',
    chapter_id: CHAPTER,
    message_id: MESSAGE_ID,
    reported_content: 'go away',
    reported_sender_id: 'user-abuser',
    reported_author_name: null,
    reason: 'harassment',
    details: null,
    status: 'open',
    created_at: '2026-03-01T00:01:00.000Z',
    resolved_at: null,
    resolved_by: null,
  };

  let service: ChatReportService;
  let reportRepo: jest.Mocked<IChatMessageReportRepository>;
  let channelAccess: { assertMessageAccess: jest.Mock };
  let chatService: { deleteReportedMessage: jest.Mock };
  let rbac: { findUserIdsWithPermissions: jest.Mock };
  let notificationService: { notifyUser: jest.Mock };

  beforeEach(async () => {
    reportRepo = {
      create: jest
        .fn()
        .mockResolvedValue({ report: baseReport, created: true }),
      findById: jest.fn().mockResolvedValue(baseReport),
      findByChapterAndStatus: jest.fn().mockResolvedValue([baseReport]),
      resolve: jest.fn().mockResolvedValue(baseReport),
    };
    channelAccess = {
      assertMessageAccess: jest.fn().mockResolvedValue(baseMessage),
    };
    chatService = {
      deleteReportedMessage: jest.fn().mockResolvedValue(undefined),
    };
    // Nobody to notify by default, so the filing cases do not depend on it; the
    // notification block seeds the roster.
    rbac = { findUserIdsWithPermissions: jest.fn().mockResolvedValue([]) };
    notificationService = {
      notifyUser: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatReportService,
        { provide: CHAT_MESSAGE_REPORT_REPOSITORY, useValue: reportRepo },
        { provide: ChannelAccessService, useValue: channelAccess },
        { provide: ChatService, useValue: chatService },
        { provide: RbacService, useValue: rbac },
        { provide: NotificationService, useValue: notificationService },
      ],
    }).compile();

    service = module.get(ChatReportService);
  });

  describe('fileReport', () => {
    it('authorizes the message as a READ before writing anything', async () => {
      await service.fileReport(CHAPTER, REPORTER, {
        message_id: MESSAGE_ID,
        reason: 'harassment',
      });

      // `'read'` is the default operation on the seam, and it is the right one:
      // a member must be able to report in #announcements, which they can read
      // but not post to. Passing `'post'` would deny exactly that.
      expect(channelAccess.assertMessageAccess).toHaveBeenCalledWith(
        MESSAGE_ID,
        CHAPTER,
        REPORTER,
      );
    });

    it('does not file a report for a message in a channel the caller cannot access', async () => {
      // The authorization boundary. `ChannelAccessService` answers 403 for a
      // channel the member cannot see (and normalizes a cross-chapter channel to
      // a 404 so the two cannot be told apart) — this asserts the service does
      // not reach the repository anyway.
      channelAccess.assertMessageAccess.mockRejectedValue(
        new ForbiddenException('You do not have access to this channel'),
      );

      await expect(
        service.fileReport(CHAPTER, REPORTER, {
          message_id: MESSAGE_ID,
          reason: 'harassment',
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(reportRepo.create).not.toHaveBeenCalled();
    });

    it('files as the caller, in the caller chapter', async () => {
      await service.fileReport(CHAPTER, REPORTER, {
        message_id: MESSAGE_ID,
        reason: 'spam',
        details: 'third time today',
      });

      expect(reportRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          chapter_id: CHAPTER,
          reporter_user_id: REPORTER,
          message_id: MESSAGE_ID,
          reason: 'spam',
          details: 'third time today',
        }),
      );
    });

    it('snapshots the evidence from the authorized message row', async () => {
      // Without the snapshot the report names a message whose content the
      // reported member controls: `deleteMessage` lets a sender soft-delete
      // their own message, overwriting `content` with "[message deleted]".
      await service.fileReport(CHAPTER, REPORTER, {
        message_id: MESSAGE_ID,
        reason: 'harassment',
      });

      expect(reportRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          reported_content: 'go away',
          reported_sender_id: 'user-abuser',
          reported_author_name: null,
        }),
      );
    });

    it('snapshots author_name for an imported message with no sender_id', async () => {
      // The case that makes carrying BOTH author columns necessary rather than
      // belt-and-braces. A Discord-imported row has `sender_id: null` and names
      // its author in `author_name`; mirroring `sender_id` alone would snapshot
      // nobody — and the import purge hard-deletes exactly these rows, at which
      // point `message_id` goes NULL and the officer has content and no author.
      channelAccess.assertMessageAccess.mockResolvedValue({
        ...baseMessage,
        sender_id: null,
        author_name: 'someone#1234',
      } satisfies ChatMessage);

      await service.fileReport(CHAPTER, REPORTER, {
        message_id: MESSAGE_ID,
        reason: 'hate',
      });

      expect(reportRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          reported_sender_id: null,
          reported_author_name: 'someone#1234',
        }),
      );
    });

    it('returns whatever the repository resolved, so a duplicate open report is not an error', async () => {
      // Idempotency lives in the repository (the partial unique index cannot be
      // an ON CONFLICT arbiter, so it inserts and re-selects). What this pins is
      // that the service adds no second-guessing on top: the caller gets a
      // report either way, never a 5xx.
      const existing = { ...baseReport, id: 'report-already-open' };
      reportRepo.create.mockResolvedValue({ report: existing, created: false });

      const result = await service.fileReport(CHAPTER, REPORTER, {
        message_id: MESSAGE_ID,
        reason: 'harassment',
      });

      expect(result).toBe(existing);
    });
  });

  // Officers are told a report is waiting (#2257). The notification is the
  // "timely response" half of Guideline 1.2, and it is also a disclosure
  // surface, so both who gets it and what it says are pinned here.
  describe('fileReport — officer notification', () => {
    const PRESIDENT = 'user-president';
    const MODERATOR = 'user-moderator';
    const ABUSER = 'user-abuser';

    const file = () =>
      service.fileReport(CHAPTER, REPORTER, {
        message_id: MESSAGE_ID,
        reason: 'harassment',
      });

    const notifiedUserIds = () =>
      notificationService.notifyUser.mock.calls.map(([userId]) => userId);

    it('asks for exactly the members the officer queue would admit, in the report chapter', async () => {
      await file();

      expect(rbac.findUserIdsWithPermissions).toHaveBeenCalledWith(
        CHAPTER,
        REPORT_QUEUE_PERMISSIONS,
      );
      // The queue route is `members:view` (class) AND `channels:manage`
      // (handler). A narrower set would miss someone who can act; a wider one
      // would page someone about a queue that answers them 403.
      expect([...REPORT_QUEUE_PERMISSIONS].sort()).toEqual(
        [
          SystemPermissions.MEMBERS_VIEW,
          SystemPermissions.CHANNELS_MANAGE,
        ].sort(),
      );
    });

    it('notifies every officer the chapter-scoped resolver returns, in that chapter', async () => {
      // Wildcard holders and `channels:manage` holders alike come back from the
      // resolver, and plain members and other chapters' officers never do —
      // both halves are pinned in rbac.service.spec.ts
      // ("findUserIdsWithPermissions").
      rbac.findUserIdsWithPermissions.mockResolvedValue([PRESIDENT, MODERATOR]);

      await file();

      expect(
        notificationService.notifyUser.mock.calls.map(([userId, chapterId]) => [
          userId,
          chapterId,
        ]),
      ).toEqual([
        [PRESIDENT, CHAPTER],
        [MODERATOR, CHAPTER],
      ]);
    });

    it('does not notify the reported sender, even when they are an officer', async () => {
      rbac.findUserIdsWithPermissions.mockResolvedValue([PRESIDENT, ABUSER]);

      await file();

      expect(notifiedUserIds()).toEqual([PRESIDENT]);
    });

    it('does not notify the reporter about their own report', async () => {
      rbac.findUserIdsWithPermissions.mockResolvedValue([PRESIDENT, REPORTER]);

      await file();

      expect(notifiedUserIds()).toEqual([PRESIDENT]);
    });

    it('carries no message text, reporter, or reported member', async () => {
      rbac.findUserIdsWithPermissions.mockResolvedValue([PRESIDENT]);
      reportRepo.create.mockResolvedValue({
        report: { ...baseReport, details: 'he keeps doing this' },
        created: true,
      });

      await file();

      const [, , payload] = notificationService.notifyUser.mock.calls[0];
      expect(payload).toBe(REPORT_FILED_NOTIFICATION);
      const rendered = JSON.stringify(payload);
      for (const secret of [
        baseMessage.content,
        'he keeps doing this',
        REPORTER,
        ABUSER,
        MESSAGE_ID,
      ]) {
        expect(rendered).not.toContain(secret);
      }
      expect(payload).toMatchObject({
        priority: 'NORMAL',
        category: 'admin',
        data: { target: { screen: 'chat_reports' } },
      });
    });

    it('sends nothing for a replayed report', async () => {
      // A double-tap or an offline retry returns the existing open report. It
      // must not page the moderation team again, or re-filing becomes a way to
      // spam every officer.
      rbac.findUserIdsWithPermissions.mockResolvedValue([PRESIDENT]);
      reportRepo.create.mockResolvedValue({
        report: baseReport,
        created: false,
      });

      await file();

      expect(rbac.findUserIdsWithPermissions).not.toHaveBeenCalled();
      expect(notificationService.notifyUser).not.toHaveBeenCalled();
    });

    it('still files the report when one delivery fails, and still notifies the others', async () => {
      rbac.findUserIdsWithPermissions.mockResolvedValue([PRESIDENT, MODERATOR]);
      notificationService.notifyUser
        .mockRejectedValueOnce(new Error('delivery failed'))
        .mockResolvedValueOnce(undefined);

      await expect(file()).resolves.toBe(baseReport);
      expect(notificationService.notifyUser).toHaveBeenCalledTimes(2);
    });

    it('still files the report when the officer roster cannot be read', async () => {
      rbac.findUserIdsWithPermissions.mockRejectedValue(new Error('db down'));

      await expect(file()).resolves.toBe(baseReport);
      expect(notificationService.notifyUser).not.toHaveBeenCalled();
    });
  });

  // #2311, option 1: the report row is the capability to remove the one message
  // it names. The authorization itself runs end-to-end — over a real
  // ChannelAccessService and a DM the officer is not in — in
  // chat.service.spec.ts ("deleteReportedMessage"); these cases pin what this
  // service decides before it gets there.
  describe('removeReportedMessage', () => {
    it('reads the report in the caller chapter, removes its message, then marks it actioned', async () => {
      const actioned = { ...baseReport, status: 'actioned' as const };
      reportRepo.resolve.mockResolvedValue(actioned);

      const result = await service.removeReportedMessage(
        'report-1',
        CHAPTER,
        OFFICER,
      );

      expect(reportRepo.findById).toHaveBeenCalledWith('report-1', CHAPTER);
      expect(chatService.deleteReportedMessage).toHaveBeenCalledTimes(1);
      const [grant, chapterId, officer] =
        chatService.deleteReportedMessage.mock.calls[0];
      expect(grant).toBeInstanceOf(ReportedMessageGrant);
      // The grant names exactly the message the report names. The route takes
      // no message id, so there is nothing else it could name.
      expect(grant).toMatchObject({
        reportId: 'report-1',
        chapterId: CHAPTER,
        messageId: MESSAGE_ID,
      });
      expect(chapterId).toBe(CHAPTER);
      expect(officer).toBe(OFFICER);
      expect(reportRepo.resolve).toHaveBeenCalledWith(
        'report-1',
        CHAPTER,
        'actioned',
        OFFICER,
        expect.any(String),
      );
      expect(result).toBe(actioned);
      // Removal before resolution, so a failed removal never leaves an
      // `actioned` report over a message that is still there.
      expect(
        chatService.deleteReportedMessage.mock.invocationCallOrder[0],
      ).toBeLessThan(reportRepo.resolve.mock.invocationCallOrder[0]);
    });

    it('404s a report from another chapter without touching any message', async () => {
      // The repository read is chapter-scoped, so another chapter's report id
      // resolves to null here exactly as a nonexistent one does.
      reportRepo.findById.mockResolvedValue(null);

      await expect(
        service.removeReportedMessage('report-elsewhere', CHAPTER, OFFICER),
      ).rejects.toThrow(NotFoundException);
      expect(chatService.deleteReportedMessage).not.toHaveBeenCalled();
      expect(reportRepo.resolve).not.toHaveBeenCalled();
    });

    it.each(['reviewed', 'actioned', 'dismissed'] as const)(
      'refuses once the report is %s, because only an OPEN report is a capability',
      async (status) => {
        reportRepo.findById.mockResolvedValue({ ...baseReport, status });

        await expect(
          service.removeReportedMessage('report-1', CHAPTER, OFFICER),
        ).rejects.toThrow(ConflictException);
        expect(chatService.deleteReportedMessage).not.toHaveBeenCalled();
        expect(reportRepo.resolve).not.toHaveBeenCalled();
      },
    );

    it('refuses when the reported message was hard-deleted (message_id went NULL)', async () => {
      reportRepo.findById.mockResolvedValue({
        ...baseReport,
        message_id: null,
      });

      await expect(
        service.removeReportedMessage('report-1', CHAPTER, OFFICER),
      ).rejects.toThrow(ConflictException);
      expect(chatService.deleteReportedMessage).not.toHaveBeenCalled();
    });

    it('leaves the report open when the removal is refused', async () => {
      chatService.deleteReportedMessage.mockRejectedValue(
        new ConflictException('The reported message is already deleted'),
      );

      await expect(
        service.removeReportedMessage('report-1', CHAPTER, OFFICER),
      ).rejects.toThrow(ConflictException);
      expect(reportRepo.resolve).not.toHaveBeenCalled();
    });
  });

  describe('listReports', () => {
    it('defaults to the open queue for the caller chapter', async () => {
      await service.listReports(CHAPTER);

      expect(reportRepo.findByChapterAndStatus).toHaveBeenCalledWith(
        CHAPTER,
        'open',
      );
    });

    it('reads the requested status, still scoped to the caller chapter', async () => {
      await service.listReports(CHAPTER, 'dismissed');

      expect(reportRepo.findByChapterAndStatus).toHaveBeenCalledWith(
        CHAPTER,
        'dismissed',
      );
    });
  });

  describe('resolveReport', () => {
    it('passes the caller chapter and stamps the officer', async () => {
      await service.resolveReport('report-1', CHAPTER, 'actioned', OFFICER);

      expect(reportRepo.resolve).toHaveBeenCalledWith(
        'report-1',
        CHAPTER,
        'actioned',
        OFFICER,
        expect.any(String),
      );
    });

    it('404s a report that does not resolve inside the caller chapter', async () => {
      // A `channels:manage` holder is authorized to moderate *their* chapter,
      // and a report id is a bare UUID. The repository answers null when the
      // chapter predicate does not match; the same 404 covers "no such report",
      // so the endpoint does not confirm an id exists somewhere else.
      reportRepo.resolve.mockResolvedValue(null);

      await expect(
        service.resolveReport(
          'report-elsewhere',
          CHAPTER,
          'dismissed',
          OFFICER,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
