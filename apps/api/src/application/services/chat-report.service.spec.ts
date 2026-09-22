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
      resolveOpenForMessage: jest
        .fn()
        .mockResolvedValue([{ ...baseReport, status: 'actioned' }]),
    };
    channelAccess = {
      assertMessageAccess: jest.fn().mockResolvedValue(baseMessage),
    };
    chatService = {
      deleteReportedMessage: jest
        .fn()
        .mockResolvedValue({ alreadyDeleted: false }),
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

    it('refuses a message that is already deleted, before writing or notifying', async () => {
      // Its content is "[message deleted]" for everyone, so an officer would be
      // paged about a report with nothing left to act on.
      channelAccess.assertMessageAccess.mockResolvedValue({
        ...baseMessage,
        content: '[message deleted]',
        is_deleted: true,
      } satisfies ChatMessage);
      rbac.findUserIdsWithPermissions.mockResolvedValue(['user-president']);

      await expect(
        service.fileReport(CHAPTER, REPORTER, {
          message_id: MESSAGE_ID,
          reason: 'harassment',
        }),
      ).rejects.toThrow(ConflictException);
      expect(reportRepo.create).not.toHaveBeenCalled();
      expect(notificationService.notifyUser).not.toHaveBeenCalled();
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

    it('notifies nobody, and says so in the log, when the reported sender is the only queue holder', async () => {
      // The report is kept (it stays open for whoever next holds the queue
      // permissions); what must not happen is the sender being paged, or the
      // gap passing without a trace.
      rbac.findUserIdsWithPermissions.mockResolvedValue([ABUSER]);
      const warn = jest
        .spyOn(
          (service as unknown as { logger: { warn: jest.Mock } }).logger,
          'warn',
        )
        .mockImplementation(() => undefined);

      await expect(file()).resolves.toBe(baseReport);

      expect(notificationService.notifyUser).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(
        'A chat report was filed with nobody able to review it',
        { reportId: baseReport.id, chapterId: CHAPTER },
      );
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
  // service decides before and after it.
  describe('removeReportedMessage', () => {
    const actioned = {
      ...baseReport,
      status: 'actioned' as const,
      resolved_by: OFFICER,
      resolved_at: '2026-03-02T00:00:00.000Z',
    };

    it('reads the report as the caller may see it, removes its message, then closes it', async () => {
      reportRepo.resolveOpenForMessage.mockResolvedValue([actioned]);

      const result = await service.removeReportedMessage(
        'report-1',
        CHAPTER,
        OFFICER,
      );

      // Chapter-scoped, and excluding reports about the caller.
      expect(reportRepo.findById).toHaveBeenCalledWith(
        'report-1',
        CHAPTER,
        OFFICER,
      );
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
      expect(reportRepo.resolveOpenForMessage).toHaveBeenCalledWith(
        CHAPTER,
        MESSAGE_ID,
        'actioned',
        OFFICER,
        expect.any(String),
      );
      expect(result).toEqual({ ...actioned, message_already_deleted: false });
      // Removal before resolution, so a failed removal never leaves an
      // `actioned` report over a message that is still there.
      expect(
        chatService.deleteReportedMessage.mock.invocationCallOrder[0],
      ).toBeLessThan(
        reportRepo.resolveOpenForMessage.mock.invocationCallOrder[0],
      );
    });

    it('closes every open report on the message, not only the one clicked', async () => {
      // Two members reported the same message. Once it is gone both reports
      // have been acted on; leaving the sibling open would keep a report in
      // the queue over a message that no longer exists.
      const sibling = { ...actioned, id: 'report-2' };
      reportRepo.resolveOpenForMessage.mockResolvedValue([sibling, actioned]);

      const result = await service.removeReportedMessage(
        'report-1',
        CHAPTER,
        OFFICER,
      );

      expect(reportRepo.resolveOpenForMessage).toHaveBeenCalledTimes(1);
      // One statement closes the set; nothing resolves the named report on its
      // own, where a sibling could be missed.
      expect(reportRepo.resolve).not.toHaveBeenCalled();
      expect(result.id).toBe('report-1');
    });

    it('still closes the reports when the message was already deleted, and says so', async () => {
      // Deleted by its sender, by an ordinary officer delete, by a sibling's
      // removal, or by an earlier attempt that failed after the delete landed.
      chatService.deleteReportedMessage.mockResolvedValue({
        alreadyDeleted: true,
      });
      reportRepo.resolveOpenForMessage.mockResolvedValue([actioned]);

      const result = await service.removeReportedMessage(
        'report-1',
        CHAPTER,
        OFFICER,
      );

      expect(result).toEqual({ ...actioned, message_already_deleted: true });
      expect(reportRepo.resolveOpenForMessage).toHaveBeenCalledTimes(1);
    });

    it("succeeds when another officer's removal closed this report first", async () => {
      // Two officers on sibling reports at once: the first sweep closed both,
      // so the second finds the message gone and nothing left open. The report
      // is `actioned`, which is what was asked for.
      chatService.deleteReportedMessage.mockResolvedValue({
        alreadyDeleted: true,
      });
      reportRepo.resolveOpenForMessage.mockResolvedValue([]);
      const byOther = { ...actioned, resolved_by: 'user-other-officer' };
      reportRepo.findById
        .mockResolvedValueOnce(baseReport)
        .mockResolvedValueOnce(byOther);

      const result = await service.removeReportedMessage(
        'report-1',
        CHAPTER,
        OFFICER,
      );

      expect(result).toEqual({ ...byOther, message_already_deleted: true });
    });

    it('409s when the report was dismissed while the message was being removed', async () => {
      reportRepo.resolveOpenForMessage.mockResolvedValue([]);
      reportRepo.findById
        .mockResolvedValueOnce(baseReport)
        .mockResolvedValueOnce({ ...baseReport, status: 'dismissed' });

      await expect(
        service.removeReportedMessage('report-1', CHAPTER, OFFICER),
      ).rejects.toThrow(ConflictException);
    });

    it("404s a report it cannot see — another chapter's, or one about the caller — without touching any message", async () => {
      // The repository read is chapter-scoped and leaves out reports whose
      // reported sender is the caller, so both resolve to null here exactly as
      // a nonexistent one does (the predicates are proven in
      // supabase-chat-message-report.repository.spec.ts).
      reportRepo.findById.mockResolvedValue(null);

      await expect(
        service.removeReportedMessage('report-elsewhere', CHAPTER, OFFICER),
      ).rejects.toThrow(NotFoundException);
      expect(chatService.deleteReportedMessage).not.toHaveBeenCalled();
      expect(reportRepo.resolveOpenForMessage).not.toHaveBeenCalled();
    });

    it.each(['reviewed', 'actioned', 'dismissed'] as const)(
      'refuses once the report is %s, because only an OPEN report is a capability',
      async (status) => {
        reportRepo.findById.mockResolvedValue({ ...baseReport, status });

        await expect(
          service.removeReportedMessage('report-1', CHAPTER, OFFICER),
        ).rejects.toThrow(ConflictException);
        expect(chatService.deleteReportedMessage).not.toHaveBeenCalled();
        expect(reportRepo.resolveOpenForMessage).not.toHaveBeenCalled();
      },
    );

    it('409s when the reported message was hard-deleted (message_id went NULL), closing nothing', async () => {
      // Not the idempotent success a soft-deleted message gets: with no
      // message_id the sibling reports cannot be found, so closing this one
      // alone would leave them open. The officer closes it explicitly.
      reportRepo.findById.mockResolvedValue({
        ...baseReport,
        message_id: null,
      });

      await expect(
        service.removeReportedMessage('report-1', CHAPTER, OFFICER),
      ).rejects.toThrow(ConflictException);
      expect(chatService.deleteReportedMessage).not.toHaveBeenCalled();
      expect(reportRepo.resolveOpenForMessage).not.toHaveBeenCalled();
    });

    it('leaves the reports open when the removal is refused', async () => {
      chatService.deleteReportedMessage.mockRejectedValue(
        new NotFoundException('Message not found'),
      );

      await expect(
        service.removeReportedMessage('report-1', CHAPTER, OFFICER),
      ).rejects.toThrow(NotFoundException);
      expect(reportRepo.resolveOpenForMessage).not.toHaveBeenCalled();
      expect(reportRepo.resolve).not.toHaveBeenCalled();
    });
  });

  describe('listReports', () => {
    it('defaults to the open queue for the caller chapter, as the caller may see it', async () => {
      await service.listReports(CHAPTER, OFFICER);

      expect(reportRepo.findByChapterAndStatus).toHaveBeenCalledWith(
        CHAPTER,
        'open',
        OFFICER,
      );
    });

    it('reads the requested status, still scoped to the caller chapter and reviewer', async () => {
      await service.listReports(CHAPTER, OFFICER, 'dismissed');

      expect(reportRepo.findByChapterAndStatus).toHaveBeenCalledWith(
        CHAPTER,
        'dismissed',
        OFFICER,
      );
    });
  });

  describe('resolveReport', () => {
    it('reads the report as the caller may see it, then resolves it stamped with the officer', async () => {
      const dismissed = { ...baseReport, status: 'dismissed' as const };
      reportRepo.resolve.mockResolvedValue(dismissed);

      const result = await service.resolveReport(
        'report-1',
        CHAPTER,
        'dismissed',
        OFFICER,
      );

      expect(reportRepo.findById).toHaveBeenCalledWith(
        'report-1',
        CHAPTER,
        OFFICER,
      );
      expect(reportRepo.resolve).toHaveBeenCalledWith(
        'report-1',
        CHAPTER,
        'dismissed',
        OFFICER,
        expect.any(String),
      );
      expect(result).toBe(dismissed);
    });

    it("404s a report it cannot see — another chapter's, or one about the caller", async () => {
      // A `channels:manage` holder is authorized to moderate *their* chapter,
      // and a report id is a bare UUID. The same 404 covers "no such report"
      // and "a report about you", so the endpoint confirms nothing.
      reportRepo.findById.mockResolvedValue(null);

      await expect(
        service.resolveReport(
          'report-elsewhere',
          CHAPTER,
          'dismissed',
          OFFICER,
        ),
      ).rejects.toThrow(NotFoundException);
      expect(reportRepo.resolve).not.toHaveBeenCalled();
    });

    it.each(['reviewed', 'actioned', 'dismissed'] as const)(
      '409s a report already %s, and writes nothing',
      async (status) => {
        // A stale Mark reviewed must not overwrite an `actioned` report: the
        // record would then say a removed message was merely reviewed.
        reportRepo.findById.mockResolvedValue({ ...baseReport, status });

        await expect(
          service.resolveReport('report-1', CHAPTER, 'reviewed', OFFICER),
        ).rejects.toThrow(ConflictException);
        expect(reportRepo.resolve).not.toHaveBeenCalled();
      },
    );

    it('409s when the report is resolved between the read and the write', async () => {
      // The write is conditional on `status = 'open'`; a null from it after an
      // open read means someone else got there first.
      reportRepo.resolve.mockResolvedValue(null);

      await expect(
        service.resolveReport('report-1', CHAPTER, 'dismissed', OFFICER),
      ).rejects.toThrow(ConflictException);
    });
  });
});
