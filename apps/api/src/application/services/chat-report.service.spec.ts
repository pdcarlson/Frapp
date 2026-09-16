import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ChatReportService } from './chat-report.service';
import { ChannelAccessService } from './channel-access.service';
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

  beforeEach(async () => {
    reportRepo = {
      create: jest.fn().mockResolvedValue(baseReport),
      findByChapterAndStatus: jest.fn().mockResolvedValue([baseReport]),
      resolve: jest.fn().mockResolvedValue(baseReport),
    };
    channelAccess = {
      assertMessageAccess: jest.fn().mockResolvedValue(baseMessage),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatReportService,
        { provide: CHAT_MESSAGE_REPORT_REPOSITORY, useValue: reportRepo },
        { provide: ChannelAccessService, useValue: channelAccess },
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
      reportRepo.create.mockResolvedValue(existing);

      const result = await service.fileReport(CHAPTER, REPORTER, {
        message_id: MESSAGE_ID,
        reason: 'harassment',
      });

      expect(result).toBe(existing);
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
