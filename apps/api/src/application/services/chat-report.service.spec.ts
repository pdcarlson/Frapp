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
  let chatService: {
    deleteReportedMessage: jest.Mock;
    reportedMessageState: jest.Mock;
    purgeRemovedMessageAttachments: jest.Mock;
  };
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
      findOwnOpenReport: jest.fn().mockResolvedValue(null),
      releaseClaim: jest.fn().mockResolvedValue(true),
      closeForDeletedMessage: jest.fn().mockResolvedValue(true),
    };
    channelAccess = {
      assertMessageAccess: jest.fn().mockResolvedValue(baseMessage),
    };
    chatService = {
      deleteReportedMessage: jest
        .fn()
        .mockResolvedValue({ alreadyDeleted: false, channelId: 'chan-1' }),
      // The message is still there unless a case says otherwise.
      reportedMessageState: jest
        .fn()
        .mockResolvedValue({ channelId: 'chan-1', isDeleted: false }),
      purgeRemovedMessageAttachments: jest.fn().mockResolvedValue(undefined),
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
      expect(reportRepo.findOwnOpenReport).toHaveBeenCalledWith(
        CHAPTER,
        REPORTER,
        MESSAGE_ID,
      );
      expect(reportRepo.create).not.toHaveBeenCalled();
      expect(notificationService.notifyUser).not.toHaveBeenCalled();
    });

    it('answers a replay with the open report even once the message is deleted, rather than the 409', async () => {
      // The member filed while the message was live, then its sender deleted
      // it, then the member's client re-sent (a double-tap, an offline retry).
      // The replay is the idempotent answer, and it must not become a refusal
      // that says the report was never taken.
      channelAccess.assertMessageAccess.mockResolvedValue({
        ...baseMessage,
        content: '[message deleted]',
        is_deleted: true,
      } satisfies ChatMessage);
      const existing = { ...baseReport, id: 'report-already-open' };
      reportRepo.findOwnOpenReport.mockResolvedValue(existing);
      rbac.findUserIdsWithPermissions.mockResolvedValue(['user-president']);

      await expect(
        service.fileReport(CHAPTER, REPORTER, {
          message_id: MESSAGE_ID,
          reason: 'harassment',
        }),
      ).resolves.toBe(existing);
      expect(reportRepo.create).not.toHaveBeenCalled();
      expect(notificationService.notifyUser).not.toHaveBeenCalled();
    });

    it('does not look the replay up for a live message: the insert answers it', async () => {
      await service.fileReport(CHAPTER, REPORTER, {
        message_id: MESSAGE_ID,
        reason: 'harassment',
      });

      expect(reportRepo.findOwnOpenReport).not.toHaveBeenCalled();
    });

    it('closes a report that landed on a message removed while it was written, notifies no one, and answers the same 409', async () => {
      // An officer's removal swept the message's open reports before this row
      // existed, then deleted the message. Without the re-check the new report
      // would sit open over a deleted message and page every officer.
      rbac.findUserIdsWithPermissions.mockResolvedValue(['user-president']);
      chatService.reportedMessageState.mockResolvedValue({
        channelId: 'chan-1',
        isDeleted: true,
      });

      await expect(
        service.fileReport(CHAPTER, REPORTER, {
          message_id: MESSAGE_ID,
          reason: 'harassment',
        }),
      ).rejects.toThrow(
        new ConflictException(
          'This message has been deleted and can no longer be reported',
        ),
      );
      expect(reportRepo.create).toHaveBeenCalledTimes(1);
      expect(chatService.reportedMessageState).toHaveBeenCalledWith(
        MESSAGE_ID,
        CHAPTER,
      );
      expect(reportRepo.closeForDeletedMessage).toHaveBeenCalledWith(
        baseReport.id,
        CHAPTER,
        expect.any(String),
      );
      expect(notificationService.notifyUser).not.toHaveBeenCalled();
    });

    it('treats a message hard-deleted as the report landed the same way', async () => {
      chatService.reportedMessageState.mockResolvedValue(null);

      await expect(
        service.fileReport(CHAPTER, REPORTER, {
          message_id: MESSAGE_ID,
          reason: 'harassment',
        }),
      ).rejects.toThrow(ConflictException);
      expect(reportRepo.closeForDeletedMessage).toHaveBeenCalledTimes(1);
    });

    it('re-checks only a report this call wrote, never a replay', async () => {
      reportRepo.create.mockResolvedValue({
        report: baseReport,
        created: false,
      });

      await service.fileReport(CHAPTER, REPORTER, {
        message_id: MESSAGE_ID,
        reason: 'harassment',
      });

      expect(chatService.reportedMessageState).not.toHaveBeenCalled();
      expect(reportRepo.closeForDeletedMessage).not.toHaveBeenCalled();
    });

    it('still files and notifies when the re-check read fails', async () => {
      // The row is committed. A 500 here would invite a retry that the
      // idempotent path answers silently, so no officer would ever hear.
      rbac.findUserIdsWithPermissions.mockResolvedValue(['user-president']);
      chatService.reportedMessageState.mockRejectedValue(new Error('db down'));

      await expect(
        service.fileReport(CHAPTER, REPORTER, {
          message_id: MESSAGE_ID,
          reason: 'harassment',
        }),
      ).resolves.toBe(baseReport);
      expect(reportRepo.closeForDeletedMessage).not.toHaveBeenCalled();
      expect(notificationService.notifyUser).toHaveBeenCalledTimes(1);
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

    it('notifies nobody and warns about nothing when the reporter is the only reviewer', async () => {
      // An officer reported a member's message and is the chapter's only other
      // queue holder. There is nobody to page — they filed it — but there is a
      // reviewer, so this is not the "no reviewer" gap.
      rbac.findUserIdsWithPermissions.mockResolvedValue([REPORTER]);
      const warn = jest
        .spyOn(
          (service as unknown as { logger: { warn: jest.Mock } }).logger,
          'warn',
        )
        .mockImplementation(() => undefined);

      await expect(file()).resolves.toBe(baseReport);

      expect(notificationService.notifyUser).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
    });

    it('does not warn when the reporter and the reported sender are the only queue holders', async () => {
      // The reporter can review it; nobody else can, and the queue hides it
      // from the sender. Still a reviewer, so still no warning.
      rbac.findUserIdsWithPermissions.mockResolvedValue([REPORTER, ABUSER]);
      const warn = jest
        .spyOn(
          (service as unknown as { logger: { warn: jest.Mock } }).logger,
          'warn',
        )
        .mockImplementation(() => undefined);

      await file();

      expect(notificationService.notifyUser).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
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

    beforeEach(() => {
      // The claim lands unless a case says otherwise.
      reportRepo.resolve.mockResolvedValue(actioned);
    });

    it('claims the report, then removes its message, then closes the rest', async () => {
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
      // The claim: the compare-and-set on `status = 'open'`.
      expect(reportRepo.resolve).toHaveBeenCalledWith(
        'report-1',
        CHAPTER,
        'actioned',
        OFFICER,
        expect.any(String),
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
      // The sweep, stamped with the claim's own timestamp.
      const claimedAt = reportRepo.resolve.mock.calls[0][4];
      expect(reportRepo.resolveOpenForMessage).toHaveBeenCalledWith(
        CHAPTER,
        MESSAGE_ID,
        'actioned',
        OFFICER,
        claimedAt,
      );
      expect(result).toEqual({
        ...actioned,
        message_already_deleted: false,
        channel_id: 'chan-1',
      });

      const order = (mock: jest.Mock) => mock.mock.invocationCallOrder[0];
      expect(order(reportRepo.resolve)).toBeLessThan(
        order(chatService.deleteReportedMessage),
      );
      expect(order(chatService.deleteReportedMessage)).toBeLessThan(
        order(reportRepo.resolveOpenForMessage),
      );
      expect(reportRepo.releaseClaim).not.toHaveBeenCalled();
    });

    it('closes every open report on the message, not only the one clicked', async () => {
      // Two members reported the same message. Once it is gone both reports
      // have been acted on; leaving the sibling open would keep a report in
      // the queue over a message that no longer exists. The sweep runs after
      // the delete, so it also catches a report filed while this one ran.
      await service.removeReportedMessage('report-1', CHAPTER, OFFICER);

      expect(reportRepo.resolveOpenForMessage).toHaveBeenCalledTimes(1);
      expect(reportRepo.resolveOpenForMessage).toHaveBeenCalledWith(
        CHAPTER,
        MESSAGE_ID,
        'actioned',
        OFFICER,
        expect.any(String),
      );
    });

    it('still closes the reports when the message was already deleted, and says so', async () => {
      // Deleted by its sender, by an ordinary officer delete, by a sibling's
      // removal, or by an earlier attempt that failed after the delete landed.
      chatService.deleteReportedMessage.mockResolvedValue({
        alreadyDeleted: true,
        channelId: 'chan-1',
      });

      const result = await service.removeReportedMessage(
        'report-1',
        CHAPTER,
        OFFICER,
      );

      expect(result).toEqual({
        ...actioned,
        message_already_deleted: true,
        channel_id: 'chan-1',
      });
      expect(reportRepo.resolveOpenForMessage).toHaveBeenCalledTimes(1);
    });

    it('409s without deleting when the report was dismissed before the claim', async () => {
      // The read saw it open; a Dismiss landed before the claim. The claim's
      // compare-and-set finds nothing open, so the message is never touched.
      reportRepo.resolve.mockResolvedValue(null);
      reportRepo.findById
        .mockResolvedValueOnce(baseReport)
        .mockResolvedValueOnce({ ...baseReport, status: 'dismissed' });

      await expect(
        service.removeReportedMessage('report-1', CHAPTER, OFFICER),
      ).rejects.toThrow(new ConflictException('This report is no longer open'));
      expect(chatService.deleteReportedMessage).not.toHaveBeenCalled();
      expect(reportRepo.resolveOpenForMessage).not.toHaveBeenCalled();
    });

    it("answers the same 200 when another officer's removal closed this report before the claim", async () => {
      // Two officers on sibling reports at once: the other sweep closed this
      // one between the read and the claim, and its message is gone.
      reportRepo.resolve.mockResolvedValue(null);
      const byOther = { ...actioned, resolved_by: 'user-other-officer' };
      reportRepo.findById
        .mockResolvedValueOnce(baseReport)
        .mockResolvedValueOnce(byOther);
      chatService.reportedMessageState.mockResolvedValue({
        channelId: 'chan-1',
        isDeleted: true,
      });

      const result = await service.removeReportedMessage(
        'report-1',
        CHAPTER,
        OFFICER,
      );

      expect(result).toEqual({
        ...byOther,
        message_already_deleted: true,
        channel_id: 'chan-1',
      });
      expect(chatService.deleteReportedMessage).not.toHaveBeenCalled();
    });

    it('withdraws the claim and rethrows when the removal fails, so the report is open for a retry', async () => {
      const failure = new Error('db down');
      chatService.deleteReportedMessage.mockRejectedValue(failure);

      await expect(
        service.removeReportedMessage('report-1', CHAPTER, OFFICER),
      ).rejects.toBe(failure);

      // The message is read again, chapter-scoped, before the claim goes: it
      // is still there, so nothing was removed.
      expect(chatService.reportedMessageState).toHaveBeenCalledWith(
        MESSAGE_ID,
        CHAPTER,
      );
      const claimedAt = reportRepo.resolve.mock.calls[0][4];
      expect(reportRepo.releaseClaim).toHaveBeenCalledWith(
        'report-1',
        CHAPTER,
        OFFICER,
        claimedAt,
      );
      expect(reportRepo.resolveOpenForMessage).not.toHaveBeenCalled();
    });

    it('still withdraws the claim when the message cannot be read again either', async () => {
      const failure = new Error('db down');
      chatService.deleteReportedMessage.mockRejectedValue(failure);
      chatService.reportedMessageState.mockRejectedValue(new Error('db down'));
      jest
        .spyOn(
          (service as unknown as { logger: { warn: jest.Mock } }).logger,
          'warn',
        )
        .mockImplementation(() => undefined);

      await expect(
        service.removeReportedMessage('report-1', CHAPTER, OFFICER),
      ).rejects.toBe(failure);
      expect(reportRepo.releaseClaim).toHaveBeenCalledTimes(1);
      expect(reportRepo.resolveOpenForMessage).not.toHaveBeenCalled();
    });

    it('withdraws the claim and rethrows a 4xx refusal even when the message is gone', async () => {
      // A 4xx is the access check refusing this caller before anything was
      // written — here, an officer removed from the chapter after the guard
      // admitted the request. It is not an answer about the message, so the
      // sender having deleted it already must not turn it into a 200.
      const refusal = new ForbiddenException(
        'You do not have access to this channel',
      );
      chatService.deleteReportedMessage.mockRejectedValue(refusal);
      chatService.reportedMessageState.mockResolvedValue({
        channelId: 'chan-1',
        isDeleted: true,
      });

      await expect(
        service.removeReportedMessage('report-1', CHAPTER, OFFICER),
      ).rejects.toBe(refusal);

      expect(chatService.reportedMessageState).not.toHaveBeenCalled();
      expect(reportRepo.releaseClaim).toHaveBeenCalledTimes(1);
      expect(reportRepo.resolveOpenForMessage).not.toHaveBeenCalled();
      expect(chatService.purgeRemovedMessageAttachments).not.toHaveBeenCalled();
    });

    it("keeps the removal's own error, and logs, when the claim cannot be withdrawn either", async () => {
      const failure = new NotFoundException('Message not found');
      chatService.deleteReportedMessage.mockRejectedValue(failure);
      reportRepo.releaseClaim.mockRejectedValue(new Error('db down'));
      const error = jest
        .spyOn(
          (service as unknown as { logger: { error: jest.Mock } }).logger,
          'error',
        )
        .mockImplementation(() => undefined);

      await expect(
        service.removeReportedMessage('report-1', CHAPTER, OFFICER),
      ).rejects.toBe(failure);
      expect(error).toHaveBeenCalledTimes(1);
    });

    it('answers 500 when the sweep fails after the removal, leaving the removal in place', async () => {
      // The message is gone and this report is `actioned`; a sibling may still
      // be open. A retry takes the replay path, which sweeps again.
      reportRepo.resolveOpenForMessage.mockRejectedValue(new Error('db down'));

      await expect(
        service.removeReportedMessage('report-1', CHAPTER, OFFICER),
      ).rejects.toThrow('db down');
      expect(chatService.deleteReportedMessage).toHaveBeenCalledTimes(1);
      expect(reportRepo.releaseClaim).not.toHaveBeenCalled();
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
      expect(reportRepo.resolve).not.toHaveBeenCalled();
      expect(chatService.deleteReportedMessage).not.toHaveBeenCalled();
      expect(reportRepo.resolveOpenForMessage).not.toHaveBeenCalled();
    });

    it.each(['reviewed', 'dismissed'] as const)(
      'refuses once the report is %s, because only an OPEN report is a capability',
      async (status) => {
        reportRepo.findById.mockResolvedValue({ ...baseReport, status });

        await expect(
          service.removeReportedMessage('report-1', CHAPTER, OFFICER),
        ).rejects.toThrow(ConflictException);
        expect(reportRepo.resolve).not.toHaveBeenCalled();
        expect(chatService.deleteReportedMessage).not.toHaveBeenCalled();
        expect(reportRepo.resolveOpenForMessage).not.toHaveBeenCalled();
      },
    );

    describe('a report that is already actioned', () => {
      beforeEach(() => {
        reportRepo.findById.mockResolvedValue(actioned);
      });

      it('answers the same 200 when its message is gone — a sibling removal or an earlier attempt of this one', async () => {
        chatService.reportedMessageState.mockResolvedValue({
          channelId: 'chan-1',
          isDeleted: true,
        });

        const result = await service.removeReportedMessage(
          'report-1',
          CHAPTER,
          OFFICER,
        );

        expect(result).toEqual({
          ...actioned,
          message_already_deleted: true,
          channel_id: 'chan-1',
        });
        // Nothing is claimed and nothing is written to the message: a closed
        // report grants nothing.
        expect(reportRepo.resolve).not.toHaveBeenCalled();
        expect(chatService.deleteReportedMessage).not.toHaveBeenCalled();
        expect(chatService.reportedMessageState).toHaveBeenCalledWith(
          MESSAGE_ID,
          CHAPTER,
        );
      });

      it('sweeps the siblings again, which finishes an earlier attempt whose sweep failed', async () => {
        chatService.reportedMessageState.mockResolvedValue({
          channelId: 'chan-1',
          isDeleted: true,
        });

        await service.removeReportedMessage('report-1', CHAPTER, OFFICER);

        expect(reportRepo.resolveOpenForMessage).toHaveBeenCalledWith(
          CHAPTER,
          MESSAGE_ID,
          'actioned',
          OFFICER,
          expect.any(String),
        );
      });

      it('409s when its message is still there — closed without a removal, or a removal still in flight', async () => {
        await expect(
          service.removeReportedMessage('report-1', CHAPTER, OFFICER),
        ).rejects.toThrow(
          new ConflictException('This report is no longer open'),
        );
        expect(chatService.deleteReportedMessage).not.toHaveBeenCalled();
        expect(reportRepo.resolveOpenForMessage).not.toHaveBeenCalled();
      });

      it('answers 200 with no channel when the message row is gone altogether', async () => {
        chatService.reportedMessageState.mockResolvedValue(null);

        await expect(
          service.removeReportedMessage('report-1', CHAPTER, OFFICER),
        ).resolves.toEqual({
          ...actioned,
          message_already_deleted: true,
          channel_id: null,
        });
      });

      it('answers 200 without reading anything when its message was hard-deleted', async () => {
        reportRepo.findById.mockResolvedValue({
          ...actioned,
          message_id: null,
        });

        await expect(
          service.removeReportedMessage('report-1', CHAPTER, OFFICER),
        ).resolves.toMatchObject({
          message_already_deleted: true,
          channel_id: null,
        });
        expect(chatService.reportedMessageState).not.toHaveBeenCalled();
      });
    });

    it("409s when an OPEN report's message was hard-deleted (message_id went NULL), closing nothing", async () => {
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
      expect(reportRepo.resolve).not.toHaveBeenCalled();
      expect(chatService.deleteReportedMessage).not.toHaveBeenCalled();
      expect(reportRepo.resolveOpenForMessage).not.toHaveBeenCalled();
    });
  });

  /**
   * Two officers acting on one report at once, over an in-memory store whose
   * writes are the repository's compare-and-sets — so the interleavings below
   * are the real ones, not a mock's scripted answers.
   */
  describe('removeReportedMessage against a concurrent Dismiss', () => {
    const OTHER_OFFICER = 'user-other-officer';
    let rows: Map<string, ChatMessageReportView>;
    let messageDeleted: boolean;

    const current = (id: string) => rows.get(id)!;

    beforeEach(() => {
      rows = new Map([
        ['report-1', { ...baseReport }],
        ['report-2', { ...baseReport, id: 'report-2', reason: 'spam' }],
      ]);
      messageDeleted = false;

      const visible = (row: ChatMessageReportView, chapterId: string) =>
        row.chapter_id === chapterId;
      reportRepo.findById.mockImplementation(async (id, chapterId) => {
        const row = rows.get(id);
        return row && visible(row, chapterId) ? { ...row } : null;
      });
      reportRepo.resolve.mockImplementation(
        async (id, chapterId, status, by, at) => {
          const row = rows.get(id);
          if (!row || !visible(row, chapterId) || row.status !== 'open') {
            return null;
          }
          Object.assign(row, { status, resolved_by: by, resolved_at: at });
          return { ...row };
        },
      );
      reportRepo.resolveOpenForMessage.mockImplementation(
        async (chapterId, messageId, status, by, at) => {
          const closed: ChatMessageReportView[] = [];
          for (const row of rows.values()) {
            if (
              visible(row, chapterId) &&
              row.message_id === messageId &&
              row.status === 'open'
            ) {
              Object.assign(row, { status, resolved_by: by, resolved_at: at });
              closed.push({ ...row });
            }
          }
          return closed;
        },
      );
      reportRepo.releaseClaim.mockImplementation(
        async (id, chapterId, by, at) => {
          const row = rows.get(id);
          if (
            !row ||
            !visible(row, chapterId) ||
            row.status !== 'actioned' ||
            row.resolved_by !== by ||
            row.resolved_at !== at
          ) {
            return false;
          }
          Object.assign(row, {
            status: 'open',
            resolved_by: null,
            resolved_at: null,
          });
          return true;
        },
      );
      chatService.reportedMessageState.mockImplementation(async () => ({
        channelId: 'chan-1',
        isDeleted: messageDeleted,
      }));
      chatService.deleteReportedMessage.mockImplementation(async () => {
        const alreadyDeleted = messageDeleted;
        messageDeleted = true;
        return { alreadyDeleted, channelId: 'chan-1' };
      });
    });

    it('a Dismiss that lands between the status read and the claim wins, and the message is never removed', async () => {
      // The race a status read alone lost: the report was open when read, and
      // the removal would have gone ahead on a capability that was gone.
      const read = reportRepo.findById.getMockImplementation()!;
      reportRepo.findById.mockImplementationOnce(async (...args) => {
        const seen = await read(...args);
        await service.resolveReport(
          'report-1',
          CHAPTER,
          'dismissed',
          OTHER_OFFICER,
        );
        return seen;
      });

      await expect(
        service.removeReportedMessage('report-1', CHAPTER, OFFICER),
      ).rejects.toThrow(new ConflictException('This report is no longer open'));

      expect(messageDeleted).toBe(false);
      expect(chatService.deleteReportedMessage).not.toHaveBeenCalled();
      expect(current('report-1')).toMatchObject({
        status: 'dismissed',
        resolved_by: OTHER_OFFICER,
      });
      // The sibling was never swept: nothing was removed.
      expect(current('report-2').status).toBe('open');
    });

    it('a Dismiss that arrives once the removal has claimed the report is the 409, and the removal completes', async () => {
      let dismissal: Promise<unknown> = Promise.resolve();
      const remove = chatService.deleteReportedMessage.getMockImplementation()!;
      chatService.deleteReportedMessage.mockImplementationOnce(
        async (...args: unknown[]) => {
          dismissal = service
            .resolveReport('report-1', CHAPTER, 'dismissed', OTHER_OFFICER)
            .catch((error: unknown) => error);
          await dismissal;
          return remove(...args);
        },
      );

      const result = await service.removeReportedMessage(
        'report-1',
        CHAPTER,
        OFFICER,
      );

      expect(await dismissal).toEqual(
        new ConflictException('This report is no longer open'),
      );
      expect(messageDeleted).toBe(true);
      expect(result).toMatchObject({
        id: 'report-1',
        status: 'actioned',
        resolved_by: OFFICER,
        message_already_deleted: false,
      });
      expect(current('report-1').status).toBe('actioned');
      expect(current('report-2')).toMatchObject({
        status: 'actioned',
        resolved_by: OFFICER,
      });
    });

    it('a Dismiss after a failed removal applies, because the claim was withdrawn', async () => {
      chatService.deleteReportedMessage.mockRejectedValueOnce(
        new Error('db down'),
      );

      await expect(
        service.removeReportedMessage('report-1', CHAPTER, OFFICER),
      ).rejects.toThrow('db down');
      expect(current('report-1')).toMatchObject({
        status: 'open',
        resolved_by: null,
        resolved_at: null,
      });

      await expect(
        service.resolveReport('report-1', CHAPTER, 'dismissed', OTHER_OFFICER),
      ).resolves.toMatchObject({ status: 'dismissed' });
    });

    it('a delete that commits and then throws keeps the claim, closes the siblings, and a retry answers 200', async () => {
      // Postgres committed the tombstone; the answer was lost on the way back.
      const lost = new Error('fetch failed');
      chatService.deleteReportedMessage.mockImplementationOnce(async () => {
        messageDeleted = true;
        throw lost;
      });

      // This call's own write may be what landed, so the outcome is reported
      // as unknown — the original error — not as a removal or a refusal.
      await expect(
        service.removeReportedMessage('report-1', CHAPTER, OFFICER),
      ).rejects.toBe(lost);

      // Not reopened over a removed message, and the sibling closed with it.
      expect(reportRepo.releaseClaim).not.toHaveBeenCalled();
      // The Storage purge that follows a committed tombstone never ran in the
      // failed call, so it runs here.
      expect(chatService.purgeRemovedMessageAttachments).toHaveBeenCalledTimes(
        1,
      );
      expect(chatService.purgeRemovedMessageAttachments).toHaveBeenCalledWith(
        MESSAGE_ID,
        CHAPTER,
      );
      expect(current('report-1')).toMatchObject({
        status: 'actioned',
        resolved_by: OFFICER,
      });
      expect(current('report-2')).toMatchObject({
        status: 'actioned',
        resolved_by: OFFICER,
      });
      // So a Dismiss cannot record the removed message as left up.
      await expect(
        service.resolveReport('report-1', CHAPTER, 'dismissed', OTHER_OFFICER),
      ).rejects.toThrow(new ConflictException('This report is no longer open'));

      await expect(
        service.removeReportedMessage('report-1', CHAPTER, OFFICER),
      ).resolves.toMatchObject({
        id: 'report-1',
        status: 'actioned',
        message_already_deleted: true,
        channel_id: 'chan-1',
      });
      expect(chatService.deleteReportedMessage).toHaveBeenCalledTimes(1);
    });

    it('the second of two removals on sibling reports gets the same 200, whichever order they land in', async () => {
      const first = await service.removeReportedMessage(
        'report-1',
        CHAPTER,
        OFFICER,
      );
      // report-2 was swept by the first removal; its own Remove, clicked from
      // a queue loaded before that, is not a timing-dependent 409.
      const second = await service.removeReportedMessage(
        'report-2',
        CHAPTER,
        OTHER_OFFICER,
      );

      expect(first).toMatchObject({ message_already_deleted: false });
      expect(second).toMatchObject({
        id: 'report-2',
        status: 'actioned',
        message_already_deleted: true,
        channel_id: 'chan-1',
      });
      expect(chatService.deleteReportedMessage).toHaveBeenCalledTimes(1);
    });

    it('a retry after a lost response gets the same 200, not a 409', async () => {
      await service.removeReportedMessage('report-1', CHAPTER, OFFICER);

      await expect(
        service.removeReportedMessage('report-1', CHAPTER, OFFICER),
      ).resolves.toMatchObject({
        id: 'report-1',
        message_already_deleted: true,
      });
      expect(chatService.deleteReportedMessage).toHaveBeenCalledTimes(1);
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
