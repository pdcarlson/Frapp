import {
  BadRequestException,
  ForbiddenException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { MAX_UPLOAD_BYTES } from '@repo/validation';
import type { ReportedAttachment } from '#domain/entities/chat-moderation.entity';
import { ChatAttachmentService } from './chat-attachment.service';
import {
  baseChannel,
  baseMessage,
  createChatServiceFixture,
  type ChatServiceFixture,
} from '#test/helpers/chat-service.fixture';

// Moved out of `chat.service.spec.ts` with the methods (#1380). The fixture
// wires the real `ChatService` beside this service, so the send-path cases
// that cross both (`mint and send agree`, the delete purge) stay there.
describe('ChatAttachmentService', () => {
  let attachments: ChatAttachmentService;
  let mockChannelRepo: ChatServiceFixture['mockChannelRepo'];
  let mockMessageRepo: ChatServiceFixture['mockMessageRepo'];
  let mockAttachmentRepo: ChatServiceFixture['mockAttachmentRepo'];
  let mockStorageProvider: ChatServiceFixture['mockStorageProvider'];
  let mockRbac: ChatServiceFixture['mockRbac'];
  let mockChatBlocks: ChatServiceFixture['mockChatBlocks'];
  let mockReportRepo: ChatServiceFixture['mockReportRepo'];

  beforeEach(async () => {
    ({
      attachments,
      mockChannelRepo,
      mockMessageRepo,
      mockAttachmentRepo,
      mockStorageProvider,
      mockRbac,
      mockChatBlocks,
      mockReportRepo,
    } = await createChatServiceFixture());
  });

  describe('listMessageAttachments', () => {
    const attachmentRow = {
      id: 'att-1',
      message_id: 'msg-1',
      channel_id: 'ch-chan-1',
      bucket: 'chat',
      storage_path: 'chapters/ch-1/chat/ch-chan-1/msg-1/minutes.pdf',
      filename: 'minutes.pdf',
      content_type: 'application/pdf',
      byte_size: 2048,
      width: null,
      height: null,
      external_url: null,
      created_at: '2026-01-01T00:00:00.000Z',
    };

    it('refuses to hand out URLs for a deleted message', async () => {
      // Deletion is soft, so the ON DELETE CASCADE never fires and the rows are
      // still there. Without this the API keeps minting fresh download URLs for
      // content the sender believes they removed, and the rule would live only
      // in the web renderer — which is not where a rule about who may fetch
      // bytes belongs.
      mockChannelRepo.findById.mockResolvedValue(baseChannel);
      mockMessageRepo.findById.mockResolvedValue({
        ...baseMessage,
        is_deleted: true,
      });

      await expect(
        attachments.listMessageAttachments(
          'ch-chan-1',
          'ch-1',
          'user-1',
          'msg-1',
        ),
      ).rejects.toThrow(NotFoundException);
      expect(mockStorageProvider.getSignedDownloadUrls).not.toHaveBeenCalled();
    });

    // ── Block masking (#2324) ────────────────────────────────────────
    //
    // The masked row keeps its `id`, so the tombstone alone does not stop a
    // client asking for the files. This route is the only way to them (the
    // bucket and the table carry no read policy — pinned by
    // `chat-read-surface-ledger.spec.ts`), so this is where they are withheld.

    it('refuses to hand out URLs for a message whose sender the caller has blocked', async () => {
      mockChatBlocks.listBlockedUserIds.mockResolvedValue(['user-blocked']);
      mockMessageRepo.findById.mockResolvedValue({
        ...baseMessage,
        sender_id: 'user-blocked',
      });
      mockAttachmentRepo.findByMessage.mockResolvedValue([attachmentRow]);

      // The same 404 a deleted message gets, so the answer reads as "no such
      // message" rather than as a block-specific refusal.
      await expect(
        attachments.listMessageAttachments(
          'ch-chan-1',
          'ch-1',
          'user-1',
          'msg-1',
        ),
      ).rejects.toThrow(new NotFoundException('Message not found'));
      expect(mockChatBlocks.listBlockedUserIds).toHaveBeenCalledWith(
        'ch-1',
        'user-1',
      );
      expect(mockAttachmentRepo.findByMessage).not.toHaveBeenCalled();
      expect(mockStorageProvider.getSignedDownloadUrls).not.toHaveBeenCalled();
    });

    it('still serves the files of a sender the caller has not blocked', async () => {
      // The control for the case above: a block list with someone else on it
      // must not withhold an unrelated member's files.
      mockChatBlocks.listBlockedUserIds.mockResolvedValue(['user-blocked']);
      mockMessageRepo.findById.mockResolvedValue(baseMessage);
      mockAttachmentRepo.findByMessage.mockResolvedValue([attachmentRow]);
      mockStorageProvider.getSignedDownloadUrls.mockResolvedValue({
        [attachmentRow.storage_path]: 'https://signed/minutes.pdf',
      });

      const rows = await attachments.listMessageAttachments(
        'ch-chan-1',
        'ch-1',
        'user-1',
        'msg-1',
      );

      expect(rows.map((row) => row.download_url)).toEqual([
        'https://signed/minutes.pdf',
      ]);
    });

    it('serves an imported message, which has no sender anyone can block', async () => {
      mockChatBlocks.listBlockedUserIds.mockResolvedValue(['user-blocked']);
      mockMessageRepo.findById.mockResolvedValue({
        ...baseMessage,
        sender_id: null,
        kind: 'imported',
      });
      mockAttachmentRepo.findByMessage.mockResolvedValue([attachmentRow]);
      mockStorageProvider.getSignedDownloadUrls.mockResolvedValue({
        [attachmentRow.storage_path]: 'https://signed/minutes.pdf',
      });

      const rows = await attachments.listMessageAttachments(
        'ch-chan-1',
        'ch-1',
        'user-1',
        'msg-1',
      );

      expect(rows).toHaveLength(1);
    });

    it('withholds every file when the block list cannot be read', async () => {
      // "A block list that cannot be read is not an empty block list." Signing
      // anyway would hand a blocker the blocked member's files for as long as
      // the table was unreachable.
      mockChatBlocks.listBlockedUserIds.mockRejectedValue(new Error('pg down'));
      mockMessageRepo.findById.mockResolvedValue(baseMessage);
      mockAttachmentRepo.findByMessage.mockResolvedValue([attachmentRow]);

      await expect(
        attachments.listMessageAttachments(
          'ch-chan-1',
          'ch-1',
          'user-1',
          'msg-1',
        ),
      ).rejects.toThrow('pg down');
      expect(mockStorageProvider.getSignedDownloadUrls).not.toHaveBeenCalled();
    });

    it('omits an attachment it cannot sign rather than failing the whole list', async () => {
      // One stale path missing from the batch-sign response used to reject
      // the per-row Promise.all and take every intact attachment on the
      // message down with it — the reader saw "attachments couldn't be
      // loaded" for files that were perfectly fine. `getSignedDownloadUrls`
      // omits an unsignable path from its result rather than rejecting, so
      // this now exercises that same guarantee one level up.
      mockChannelRepo.findById.mockResolvedValue(baseChannel);
      mockMessageRepo.findById.mockResolvedValue(baseMessage);
      mockAttachmentRepo.findByMessage.mockResolvedValue([
        attachmentRow,
        {
          ...attachmentRow,
          id: 'att-2',
          storage_path: 'chapters/ch-1/chat/ch-chan-1/msg-1/gone.pdf',
        },
      ]);
      mockStorageProvider.getSignedDownloadUrls.mockResolvedValue({
        [attachmentRow.storage_path]: 'https://signed/minutes.pdf',
        // 'gone.pdf' deliberately absent — the stale-path case.
      });

      const rows = await attachments.listMessageAttachments(
        'ch-chan-1',
        'ch-1',
        'user-1',
        'msg-1',
      );

      expect(rows).toHaveLength(1);
      expect(rows[0].download_url).toBe('https://signed/minutes.pdf');
      expect(mockStorageProvider.getSignedDownloadUrls).toHaveBeenCalledTimes(
        1,
      );
      expect(mockStorageProvider.getSignedDownloadUrls).toHaveBeenCalledWith(
        'chat',
        [
          attachmentRow.storage_path,
          'chapters/ch-1/chat/ch-chan-1/msg-1/gone.pdf',
        ],
        expect.any(Number),
        true,
      );
    });

    it('omits every attachment on a bucket rather than throwing when the whole batch fails to sign', async () => {
      // The same guarantee as the single-row case, one level up: a
      // whole-bucket failure (network error, bucket unreachable) must not
      // 500 the request — it degrades to an empty list, same as before this
      // was batched.
      mockChannelRepo.findById.mockResolvedValue(baseChannel);
      mockMessageRepo.findById.mockResolvedValue(baseMessage);
      mockAttachmentRepo.findByMessage.mockResolvedValue([attachmentRow]);
      mockStorageProvider.getSignedDownloadUrls.mockRejectedValue(
        new Error('bucket unreachable'),
      );

      const rows = await attachments.listMessageAttachments(
        'ch-chan-1',
        'ch-1',
        'user-1',
        'msg-1',
      );

      expect(rows).toHaveLength(0);
    });

    it('logs the whole-bucket failure once, not once per row it took down', async () => {
      // Before this was deduped, a bucket-level failure produced one warn for
      // the bucket (with the real error) plus one more per row in it (with
      // no error) — N+1 log lines carrying one cause. Only the bucket-level
      // warn should fire; the per-row warn is for a path missing from an
      // otherwise-successful bucket, not this case.
      const warnSpy = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      mockChannelRepo.findById.mockResolvedValue(baseChannel);
      mockMessageRepo.findById.mockResolvedValue(baseMessage);
      mockAttachmentRepo.findByMessage.mockResolvedValue([
        attachmentRow,
        {
          ...attachmentRow,
          id: 'att-2',
          storage_path: 'chapters/ch-1/chat/ch-chan-1/msg-1/other.pdf',
        },
      ]);
      mockStorageProvider.getSignedDownloadUrls.mockRejectedValue(
        new Error('bucket unreachable'),
      );

      await attachments.listMessageAttachments(
        'ch-chan-1',
        'ch-1',
        'user-1',
        'msg-1',
      );

      expect(warnSpy).toHaveBeenCalledTimes(1);
      // One string (#2460): the context rides in the message, and the cause
      // follows it, so a non-Error throwable cannot reach ConsoleLogger.
      expect(warnSpy).toHaveBeenCalledWith(
        'Could not sign a batch of chat attachments {"messageId":"msg-1","channelId":"ch-chan-1","bucket":"chat"}; omitting them: bucket unreachable',
      );
      warnSpy.mockRestore();
    });

    it('signs each bucket in its own batched call when attachments span more than one bucket', async () => {
      mockChannelRepo.findById.mockResolvedValue(baseChannel);
      mockMessageRepo.findById.mockResolvedValue(baseMessage);
      const otherBucketRow = {
        ...attachmentRow,
        id: 'att-2',
        bucket: 'chat-archive',
        storage_path: 'chapters/ch-1/chat-archive/ch-chan-1/msg-1/legacy.pdf',
      };
      mockAttachmentRepo.findByMessage.mockResolvedValue([
        attachmentRow,
        otherBucketRow,
      ]);
      mockStorageProvider.getSignedDownloadUrls.mockImplementation(
        async (bucket: string, paths: string[]) =>
          Object.fromEntries(paths.map((p) => [p, `https://signed/${bucket}`])),
      );

      const rows = await attachments.listMessageAttachments(
        'ch-chan-1',
        'ch-1',
        'user-1',
        'msg-1',
      );

      expect(rows).toHaveLength(2);
      expect(mockStorageProvider.getSignedDownloadUrls).toHaveBeenCalledTimes(
        2,
      );
      expect(mockStorageProvider.getSignedDownloadUrls).toHaveBeenCalledWith(
        'chat',
        [attachmentRow.storage_path],
        expect.any(Number),
        true,
      );
      expect(mockStorageProvider.getSignedDownloadUrls).toHaveBeenCalledWith(
        'chat-archive',
        [otherBucketRow.storage_path],
        expect.any(Number),
        true,
      );
    });
  });

  describe('resolveAuthorAvatars', () => {
    // Matches `baseChannel`/`baseMember` wired in the outer `beforeEach`, so
    // `assertChannelAccess` succeeds without per-test setup.
    const CHANNEL = 'ch-chan-1';
    const CHAPTER = 'ch-1';
    const USER = 'user-1';
    const validPath =
      'chapters/ch-1/chat-archive/imports/import-1/media/abc-avatar.png';

    it('signs the paths findAuthorAvatarPaths derives from the given message ids', async () => {
      mockMessageRepo.findAuthorAvatarPaths.mockResolvedValue([validPath]);
      mockStorageProvider.getSignedDownloadUrls.mockResolvedValue({
        [validPath]: 'https://signed/avatar.png',
      });

      const result = await attachments.resolveAuthorAvatars(
        CHANNEL,
        CHAPTER,
        USER,
        ['msg-1', 'msg-2'],
      );

      expect(result).toEqual({ [validPath]: 'https://signed/avatar.png' });
      expect(mockMessageRepo.findAuthorAvatarPaths).toHaveBeenCalledWith(
        CHANNEL,
        ['msg-1', 'msg-2'],
      );
      expect(mockStorageProvider.getSignedDownloadUrls).toHaveBeenCalledWith(
        'chat-archive',
        [validPath],
        expect.any(Number),
      );
    });

    it('never signs anything from a raw path — only from what findAuthorAvatarPaths returns for this channel', async () => {
      // A message id from another channel contributes nothing because
      // `findAuthorAvatarPaths` scopes its own query by `channelId` — proven
      // at the repository layer (supabase-chat-message.repository.spec.ts);
      // here it's proven that the service never bypasses that lookup with a
      // caller-supplied path of its own.
      mockMessageRepo.findAuthorAvatarPaths.mockResolvedValue([]);

      const result = await attachments.resolveAuthorAvatars(
        CHANNEL,
        CHAPTER,
        USER,
        ['msg-from-another-channel'],
      );

      expect(result).toEqual({});
      expect(mockStorageProvider.getSignedDownloadUrls).not.toHaveBeenCalled();
    });

    it('rejects a caller with no access to the channel before deriving any paths', async () => {
      mockChannelRepo.findById.mockResolvedValue(null);

      await expect(
        attachments.resolveAuthorAvatars(CHANNEL, CHAPTER, USER, ['msg-1']),
      ).rejects.toThrow(NotFoundException);
      expect(mockMessageRepo.findAuthorAvatarPaths).not.toHaveBeenCalled();
      expect(mockStorageProvider.getSignedDownloadUrls).not.toHaveBeenCalled();
    });

    it('returns an empty map rather than throwing when signing fails entirely', async () => {
      mockMessageRepo.findAuthorAvatarPaths.mockResolvedValue([validPath]);
      mockStorageProvider.getSignedDownloadUrls.mockRejectedValue(
        new Error('bucket unreachable'),
      );

      const result = await attachments.resolveAuthorAvatars(
        CHANNEL,
        CHAPTER,
        USER,
        ['msg-1'],
      );

      expect(result).toEqual({});
    });

    it('is a no-op that never calls the storage provider when no message has an avatar path', async () => {
      mockMessageRepo.findAuthorAvatarPaths.mockResolvedValue([]);

      const result = await attachments.resolveAuthorAvatars(
        CHANNEL,
        CHAPTER,
        USER,
        [],
      );

      expect(result).toEqual({});
      expect(mockStorageProvider.getSignedDownloadUrls).not.toHaveBeenCalled();
    });
  });

  describe('report evidence (#2481)', () => {
    const row = {
      id: 'att-1',
      message_id: 'msg-1',
      channel_id: 'ch-chan-1',
      bucket: 'chat',
      storage_path: 'chapters/ch-1/chat/ch-chan-1/u/photo.png',
      filename: 'photo.png',
      content_type: 'image/png',
      byte_size: 4096,
      width: 640,
      height: 480,
      external_url: null,
      created_at: '2026-01-01T00:00:00.000Z',
    };
    const held: ReportedAttachment = {
      bucket: 'chat',
      storage_path: row.storage_path,
      filename: 'photo.png',
      content_type: 'image/png',
      byte_size: 4096,
    };
    // A backfilled row knows only a path and a filename.
    const archived: ReportedAttachment = {
      bucket: 'chat-archive',
      storage_path: 'chapters/ch-1/archive/imp/media/a.gif',
      filename: 'a.gif',
      content_type: null,
      byte_size: null,
    };

    describe('reportedAttachmentsSnapshot', () => {
      it("snapshots each attachment's object and what the member saw of it", async () => {
        mockAttachmentRepo.findByMessage.mockResolvedValue([row]);

        await expect(
          attachments.reportedAttachmentsSnapshot('msg-1', 'ch-1'),
        ).resolves.toEqual([held]);
        expect(mockAttachmentRepo.findByMessage).toHaveBeenCalledWith(
          'msg-1',
          'ch-1',
        );
      });

      it('throws when the attachments cannot be read, so no report is filed without them', async () => {
        mockAttachmentRepo.findByMessage.mockRejectedValue(
          new Error('postgrest down'),
        );

        await expect(
          attachments.reportedAttachmentsSnapshot('msg-1', 'ch-1'),
        ).rejects.toThrow('postgrest down');
      });
    });

    describe('releaseReportEvidence', () => {
      const WINDOW_START = new Date('2026-09-30T11:45:00.000Z');
      const RECENT = '2026-09-30T11:55:00.000Z';
      const STALE = '2026-09-30T09:00:00.000Z';
      const report = (id: string, ...objects: ReportedAttachment[]) => ({
        id,
        reported_attachments: objects,
      });
      const holder = (
        object: ReportedAttachment,
        heldOpen: boolean,
        pendingSince: string | null,
      ) => ({
        bucket: object.bucket,
        storage_path: object.storage_path,
        heldOpen,
        pendingSince,
      });

      it('deletes what no undeleted message and no other report still holds, and finishes every report', async () => {
        const finished = await attachments.releaseReportEvidence(
          'ch-1',
          // The same object named by two reports is weighed and deleted once.
          [report('report-1', held, archived), report('report-2', held)],
          WINDOW_START,
        );

        expect(finished).toEqual(new Set(['report-1', 'report-2']));
        // No message is excluded: the reported message itself counts while
        // it is live.
        expect(mockAttachmentRepo.findSharedObjects).toHaveBeenCalledWith(
          [
            { bucket: 'chat', storage_path: held.storage_path },
            { bucket: 'chat-archive', storage_path: archived.storage_path },
          ],
          null,
        );
        // The reports being released don't hold against each other.
        expect(mockReportRepo.findHeldObjects).toHaveBeenCalledWith('ch-1', [
          'report-1',
          'report-2',
        ]);
        expect(mockStorageProvider.deleteFiles).toHaveBeenCalledWith('chat', [
          held.storage_path,
        ]);
        expect(mockStorageProvider.deleteFiles).toHaveBeenCalledWith(
          'chat-archive',
          [archived.storage_path],
        );
      });

      it('deletes nothing a live message still shows (a report dismissed over a live message), and finishes', async () => {
        mockAttachmentRepo.findSharedObjects.mockResolvedValue([
          { bucket: 'chat', storage_path: held.storage_path },
        ]);

        await expect(
          attachments.releaseReportEvidence(
            'ch-1',
            [report('report-1', held)],
            WINDOW_START,
          ),
        ).resolves.toEqual(new Set(['report-1']));
        expect(mockStorageProvider.deleteFiles).not.toHaveBeenCalled();
      });

      it('keeps what an open report holds, and finishes: that report releases it', async () => {
        mockReportRepo.findHeldObjects.mockResolvedValue([
          holder(held, true, null),
        ]);

        await expect(
          attachments.releaseReportEvidence(
            'ch-1',
            [report('report-1', held, archived)],
            WINDOW_START,
          ),
        ).resolves.toEqual(new Set(['report-1']));
        expect(mockStorageProvider.deleteFiles).toHaveBeenCalledTimes(1);
        expect(mockStorageProvider.deleteFiles).toHaveBeenCalledWith(
          'chat-archive',
          [archived.storage_path],
        );
      });

      it('waits on a report that resolved inside the claim window, and only the reports that share it wait', async () => {
        // That may be a removal's claim still in flight, which can reopen.
        mockReportRepo.findHeldObjects.mockResolvedValue([
          holder(held, false, RECENT),
        ]);

        const finished = await attachments.releaseReportEvidence(
          'ch-1',
          [report('report-1', held), report('report-2', archived)],
          WINDOW_START,
        );

        expect(finished).toEqual(new Set(['report-2']));
        expect(mockStorageProvider.deleteFiles).toHaveBeenCalledTimes(1);
        expect(mockStorageProvider.deleteFiles).toHaveBeenCalledWith(
          'chat-archive',
          [archived.storage_path],
        );
      });

      it('does not wait on a report that resolved before the window: it will never reopen', async () => {
        // A release that failed long ago. Waiting on it could stall the
        // sweep for good; it holds nothing back.
        mockReportRepo.findHeldObjects.mockResolvedValue([
          holder(held, false, STALE),
        ]);

        await expect(
          attachments.releaseReportEvidence(
            'ch-1',
            [report('report-1', held)],
            WINDOW_START,
          ),
        ).resolves.toEqual(new Set(['report-1']));
        expect(mockStorageProvider.deleteFiles).toHaveBeenCalledWith('chat', [
          held.storage_path,
        ]);
      });

      it('finishes when a live message is what keeps an object, whoever else holds it', async () => {
        mockAttachmentRepo.findSharedObjects.mockResolvedValue([
          { bucket: 'chat', storage_path: held.storage_path },
        ]);
        mockReportRepo.findHeldObjects.mockResolvedValue([
          holder(held, false, RECENT),
        ]);

        await expect(
          attachments.releaseReportEvidence(
            'ch-1',
            [report('report-1', held)],
            WINDOW_START,
          ),
        ).resolves.toEqual(new Set(['report-1']));
        expect(mockStorageProvider.deleteFiles).not.toHaveBeenCalled();
      });

      it('deletes nothing and finishes nothing when a check cannot be read', async () => {
        mockReportRepo.findHeldObjects.mockRejectedValue(
          new Error('postgrest down'),
        );

        await expect(
          attachments.releaseReportEvidence(
            'ch-1',
            [report('report-1', held)],
            WINDOW_START,
          ),
        ).resolves.toEqual(new Set());
        expect(mockStorageProvider.deleteFiles).not.toHaveBeenCalled();
      });

      it('leaves only the reports with an object in a failed bucket unfinished', async () => {
        mockStorageProvider.deleteFiles.mockImplementation(
          async (bucket: string) => {
            if (bucket === 'chat') throw new Error('chat bucket down');
          },
        );

        const finished = await attachments.releaseReportEvidence(
          'ch-1',
          [report('report-1', held), report('report-2', archived)],
          WINDOW_START,
        );

        expect(finished).toEqual(new Set(['report-2']));
        expect(mockStorageProvider.deleteFiles).toHaveBeenCalledWith(
          'chat-archive',
          [archived.storage_path],
        );
      });

      it('leaves a report unfinished when any one of its objects failed, though the rest were deleted', async () => {
        mockStorageProvider.deleteFiles.mockImplementation(
          async (bucket: string) => {
            if (bucket === 'chat-archive') throw new Error('archive down');
          },
        );

        await expect(
          attachments.releaseReportEvidence(
            'ch-1',
            [report('report-1', held, archived)],
            WINDOW_START,
          ),
        ).resolves.toEqual(new Set());
        expect(mockStorageProvider.deleteFiles).toHaveBeenCalledWith('chat', [
          held.storage_path,
        ]);
      });

      it('leaves a report unfinished when any one of its objects must wait', async () => {
        mockReportRepo.findHeldObjects.mockResolvedValue([
          holder(archived, false, RECENT),
        ]);

        await expect(
          attachments.releaseReportEvidence(
            'ch-1',
            [report('report-1', held, archived)],
            WINDOW_START,
          ),
        ).resolves.toEqual(new Set());
        expect(mockStorageProvider.deleteFiles).toHaveBeenCalledTimes(1);
        expect(mockStorageProvider.deleteFiles).toHaveBeenCalledWith('chat', [
          held.storage_path,
        ]);
      });

      it('finishes a report that held nothing without touching anything', async () => {
        await expect(
          attachments.releaseReportEvidence(
            'ch-1',
            [report('report-1')],
            WINDOW_START,
          ),
        ).resolves.toEqual(new Set(['report-1']));
        expect(mockAttachmentRepo.findSharedObjects).not.toHaveBeenCalled();
        expect(mockStorageProvider.deleteFiles).not.toHaveBeenCalled();
      });
    });

    describe('signReportEvidence', () => {
      it('signs per bucket with a forced download, and returns no storage location', async () => {
        mockStorageProvider.getSignedDownloadUrls.mockImplementation(
          async (bucket: string, paths: string[]) =>
            Object.fromEntries(
              paths.map((path) => [path, `https://signed/${bucket}/${path}`]),
            ),
        );

        const signed = await attachments.signReportEvidence('report-1', [
          held,
          archived,
        ]);

        expect(mockStorageProvider.getSignedDownloadUrls).toHaveBeenCalledWith(
          'chat',
          [held.storage_path],
          3600,
          true,
        );
        expect(mockStorageProvider.getSignedDownloadUrls).toHaveBeenCalledWith(
          'chat-archive',
          [archived.storage_path],
          3600,
          true,
        );
        expect(signed).toEqual([
          {
            filename: 'photo.png',
            content_type: 'image/png',
            byte_size: 4096,
            download_url: `https://signed/chat/${held.storage_path}`,
          },
          {
            filename: 'a.gif',
            content_type: null,
            byte_size: null,
            download_url: `https://signed/chat-archive/${archived.storage_path}`,
          },
        ]);
      });

      it('omits a bucket that cannot be signed rather than failing the rest', async () => {
        mockStorageProvider.getSignedDownloadUrls.mockImplementation(
          async (bucket: string, paths: string[]) => {
            if (bucket === 'chat') throw new Error('storage down');
            return Object.fromEntries(paths.map((path) => [path, 'u']));
          },
        );

        const signed = await attachments.signReportEvidence('report-1', [
          held,
          archived,
        ]);

        expect(signed.map(({ filename }) => filename)).toEqual(['a.gif']);
      });

      it('logs an object missing from an otherwise signed bucket, so a lost file can be traced', async () => {
        const warnSpy = jest
          .spyOn(Logger.prototype, 'warn')
          .mockImplementation(() => undefined);
        mockStorageProvider.getSignedDownloadUrls.mockResolvedValue({});

        const signed = await attachments.signReportEvidence('report-1', [held]);

        expect(signed).toEqual([]);
        expect(warnSpy).toHaveBeenCalledWith(
          'Could not sign a chat attachment; omitting it',
          { reportId: 'report-1', storagePath: held.storage_path },
        );
        warnSpy.mockRestore();
      });
    });
  });

  describe('requestChatUploadUrl', () => {
    it('squashes storage-unsafe filename characters in the key (#2697)', async () => {
      const result = await attachments.requestChatUploadUrl(
        'ch-chan-1',
        'ch-1',
        'user-1',
        'Résumé #3 50%.pdf',
        'application/pdf',
      );

      expect(result.storagePath).toMatch(
        /^chapters\/ch-1\/chat\/ch-chan-1\/[0-9a-f-]{36}\/R_sum_ _3 50_\.pdf$/,
      );
    });

    it('strips directory components from the filename before building the key', async () => {
      const result = await attachments.requestChatUploadUrl(
        'ch-chan-1',
        'ch-1',
        'user-1',
        '../../x.pdf',
        'application/pdf',
      );

      expect(result.storagePath).toMatch(
        /^chapters\/ch-1\/chat\/ch-chan-1\/[0-9a-f-]{36}\/x\.pdf$/,
      );
    });

    it('should generate a signed upload URL for an allowed content type', async () => {
      mockStorageProvider.getSignedUploadUrl.mockResolvedValue(
        'https://storage.example.com/signed-url',
      );

      const result = await attachments.requestChatUploadUrl(
        'ch-chan-1',
        'ch-1',
        'user-1',
        'photo.png',
        'image/png',
      );

      expect(result.signedUrl).toBe('https://storage.example.com/signed-url');
      expect(result.storagePath).toContain('chapters/ch-1/chat/ch-chan-1/');
      expect(result.storagePath).toContain('/photo.png');
      expect(result.messageId).toBeDefined();
      expect(mockStorageProvider.getSignedUploadUrl).toHaveBeenCalledWith(
        'chat',
        expect.stringContaining('chapters/ch-1/chat/ch-chan-1/'),
        'image/png',
      );
    });

    it('should reject blocked executable content types', async () => {
      await expect(
        attachments.requestChatUploadUrl(
          'ch-chan-1',
          'ch-1',
          'user-1',
          'virus.exe',
          'application/x-msdownload',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject blocked .sh files', async () => {
      await expect(
        attachments.requestChatUploadUrl(
          'ch-chan-1',
          'ch-1',
          'user-1',
          'script.sh',
          'application/x-sh',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject blocked .bat files', async () => {
      await expect(
        attachments.requestChatUploadUrl(
          'ch-chan-1',
          'ch-1',
          'user-1',
          'run.bat',
          'application/x-bat',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject disallowed content type even with allowed extension', async () => {
      await expect(
        attachments.requestChatUploadUrl(
          'ch-chan-1',
          'ch-1',
          'user-1',
          'file.zip',
          'application/zip',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should accept PDF content type', async () => {
      mockStorageProvider.getSignedUploadUrl.mockResolvedValue(
        'https://storage.example.com/signed-url',
      );

      const result = await attachments.requestChatUploadUrl(
        'ch-chan-1',
        'ch-1',
        'user-1',
        'document.pdf',
        'application/pdf',
      );

      expect(result.signedUrl).toBeDefined();
      expect(result.storagePath).toContain('/document.pdf');
    });

    it('should accept a declared size at exactly the upload ceiling', async () => {
      mockStorageProvider.getSignedUploadUrl.mockResolvedValue(
        'https://storage.example.com/signed-url',
      );

      const result = await attachments.requestChatUploadUrl(
        'ch-chan-1',
        'ch-1',
        'user-1',
        'photo.png',
        'image/png',
        MAX_UPLOAD_BYTES,
      );

      expect(result.signedUrl).toBeDefined();
    });

    it('should reject a declared size one byte over the upload ceiling', async () => {
      await expect(
        attachments.requestChatUploadUrl(
          'ch-chan-1',
          'ch-1',
          'user-1',
          'photo.png',
          'image/png',
          MAX_UPLOAD_BYTES + 1,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should not require a declared size', async () => {
      mockStorageProvider.getSignedUploadUrl.mockResolvedValue(
        'https://storage.example.com/signed-url',
      );

      const result = await attachments.requestChatUploadUrl(
        'ch-chan-1',
        'ch-1',
        'user-1',
        'photo.png',
        'image/png',
      );

      expect(result.signedUrl).toBeDefined();
    });

    /**
     * The verdicts these three pin are covered by the parity table too
     * (`chat.service.spec.ts` § "mint and send agree").
     * What only they can assert is that the denial happens *before* the URL is
     * signed: parity compares thrown-or-not, so a mint reordered to sign first
     * and authorize second would still read `denied` and stay green while the
     * object had already been handed out.
     */
    describe('refuses to sign before authorizing (#2186)', () => {
      it('denies a read-only channel to a caller without announcements:post', async () => {
        mockChannelRepo.findById.mockResolvedValue({
          ...baseChannel,
          is_read_only: true,
        });

        await expect(
          attachments.requestChatUploadUrl(
            'ch-chan-1',
            'ch-1',
            'user-1',
            'photo.png',
            'image/png',
          ),
        ).rejects.toThrow(ForbiddenException);

        // The point of the fix: no URL is minted, so no bytes can land.
        expect(mockStorageProvider.getSignedUploadUrl).not.toHaveBeenCalled();
      });

      it('denies an archived channel, which is frozen against every writer', async () => {
        mockChannelRepo.findById.mockResolvedValue({
          ...baseChannel,
          type: 'GROUP_DM',
          member_ids: ['user-1', 'user-2'],
          archived_at: '2026-01-02T00:00:00.000Z',
        });

        await expect(
          attachments.requestChatUploadUrl(
            'ch-chan-1',
            'ch-1',
            'user-1',
            'photo.png',
            'image/png',
          ),
        ).rejects.toThrow(ForbiddenException);

        expect(mockStorageProvider.getSignedUploadUrl).not.toHaveBeenCalled();
      });

      it('denies an alumni member in an operational channel', async () => {
        mockRbac.hasAlumniRole.mockResolvedValue(true);

        await expect(
          attachments.requestChatUploadUrl(
            'ch-chan-1',
            'ch-1',
            'user-1',
            'photo.png',
            'image/png',
          ),
        ).rejects.toThrow(ForbiddenException);

        expect(mockStorageProvider.getSignedUploadUrl).not.toHaveBeenCalled();
      });
    });
  });
});
