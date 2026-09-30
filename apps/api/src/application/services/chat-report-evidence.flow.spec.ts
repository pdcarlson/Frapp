import { ConflictException } from '@nestjs/common';
import { ChatReportService } from './chat-report.service';
import { ChatService } from './chat.service';
import type { ChannelAccessService } from './channel-access.service';
import type { NotificationService } from './notification.service';
import type { RbacService } from './rbac.service';
import { SupabaseChatMessageAttachmentRepository } from '../../infrastructure/supabase/repositories/supabase-chat-message-attachment.repository';
import { SupabaseChatMessageReportRepository } from '../../infrastructure/supabase/repositories/supabase-chat-message-report.repository';
import type { IStorageProvider } from '#domain/adapters/storage.interface';
import type { ChatMessage } from '#domain/entities/chat.entity';
import {
  CHAPTER_A,
  USER_A,
  USER_B,
  USER_SHARED,
  createTenantHarness,
  inA,
  inB,
  type TenantHarness,
} from '#test/helpers/tenant-scope.harness';

/**
 * A reported photo survives its sender's delete and is released when the
 * report resolves (#2481), as one chain through the real services.
 *
 * The unit specs each mock the layer beside them: `chat-report.service.spec`
 * mocks `ChatService`, and `chat.service.spec` mocks the report repository.
 * Neither would notice the snapshot `fileReport` stores failing to reach the
 * purge's hold or `resolveReport`'s release. So this runs the real
 * `ChatReportService` and `ChatService` over the real report and attachment
 * repositories, on the tenant harness, with Storage kept in memory. Channel
 * access, the roster and notifications are stubbed: they decide who may act,
 * which their own specs cover, not what happens to the files.
 *
 * The harness models PostgREST's filtering, not Postgres: how the `jsonb`
 * holding predicate behaves on a real database is proven by
 * `test/integration/chat-report-attachment-evidence.integration-spec.ts`
 * against a live stack.
 */
describe('Reported attachment evidence, end to end (#2481)', () => {
  const REPORTER = USER_SHARED;
  const SENDER = USER_A;
  const OFFICER = USER_B;
  const CHANNEL = '0a000000-0000-4000-8000-000000000501';
  const CHANNEL_B = '0b000000-0000-4000-8000-000000000501';
  const REPORTED = '0a000000-0000-4000-8000-000000000502';
  const UNREPORTED = '0a000000-0000-4000-8000-000000000503';
  const PHOTO = `chapters/${CHAPTER_A}/chat/${CHANNEL}/u1/photo.png`;
  const OTHER = `chapters/${CHAPTER_A}/chat/${CHANNEL}/u2/other.png`;

  let harness: TenantHarness;
  let stored: Set<string>;
  let messages: Map<string, ChatMessage>;
  let reports: ChatReportService;
  let chat: ChatService;

  const attachmentRow = (id: string, messageId: string, path: string) => ({
    id,
    message_id: messageId,
    channel_id: CHANNEL,
    bucket: 'chat',
    storage_path: path,
    filename: path.split('/').pop(),
    content_type: 'image/png',
    byte_size: 2048,
    width: null,
    height: null,
    external_url: null,
    created_at: '2026-09-30T00:00:00.000Z',
    // The reads join these; the harness serves whatever the row carries.
    chat_channels: { chapter_id: CHAPTER_A },
    chat_messages: { is_deleted: false },
  });

  const oldReport = {
    message_id: null,
    reporter_user_id: REPORTER,
    reported_content: 'old',
    reported_sender_id: SENDER,
    reported_author_name: null,
    reported_attachments: [],
    evidence_released_at: null,
    reason: 'spam',
    details: null,
    status: 'dismissed',
    created_at: '2026-01-01T00:00:00.000Z',
    resolved_at: '2026-01-02T00:00:00.000Z',
    resolved_by: OFFICER,
  };

  const message = (id: string): ChatMessage => ({
    id,
    channel_id: CHANNEL,
    sender_id: SENDER,
    content: '',
    type: 'TEXT',
    reply_to_id: null,
    metadata: { attachment_count: 1 },
    is_pinned: false,
    pinned_at: null,
    edited_at: null,
    is_deleted: false,
    created_at: '2026-09-30T00:00:00.000Z',
  });

  /**
   * The sender's delete: the tombstone `softDeleteMessage` writes, as the
   * attachment read's join and the message read see it, then its purge.
   */
  async function senderDeletes(messageId: string): Promise<void> {
    messages.set(messageId, {
      ...messages.get(messageId)!,
      content: '[message deleted]',
      is_deleted: true,
    });
    const { error } = await harness.client
      .from('chat_message_attachments')
      .update({ chat_messages: { is_deleted: true } } as never)
      .eq('message_id', messageId);
    if (error) throw new Error(error.message);
    await chat.purgeRemovedMessageAttachments(messageId, CHAPTER_A);
  }

  beforeEach(() => {
    harness = createTenantHarness({
      tables: {
        chat_channels: [
          inA({ id: CHANNEL, name: 'dm', type: 'DM' }),
          inB({ id: CHANNEL_B, name: 'dm', type: 'DM' }),
        ],
        chat_message_attachments: [
          attachmentRow('att-1', REPORTED, PHOTO),
          attachmentRow('att-2', UNREPORTED, OTHER),
        ],
        // The harness wants each tenanted table seeded in both chapters.
        // These twins are an old, dismissed report that holds nothing, so
        // they must never show up in a hold or a release.
        chat_message_reports: [
          inA({ id: '0a000000-0000-4000-8000-000000000509', ...oldReport }),
          inB({ id: '0b000000-0000-4000-8000-000000000509', ...oldReport }),
        ],
      },
      untenantedTables: ['chat_message_attachments'],
      // A filed report is `open` and unreleased because Postgres defaults it.
      columnDefaults: {
        chat_message_reports: {
          status: 'open',
          evidence_released_at: null,
          resolved_at: null,
          resolved_by: null,
          created_at: '2026-09-30T00:00:00.000Z',
        },
      },
    });
    stored = new Set([`chat ${PHOTO}`, `chat ${OTHER}`]);
    messages = new Map([
      [REPORTED, message(REPORTED)],
      [UNREPORTED, message(UNREPORTED)],
    ]);

    const storage = {
      deleteFiles: jest.fn(async (bucket: string, paths: string[]) => {
        for (const path of paths) stored.delete(`${bucket} ${path}`);
      }),
      getSignedDownloadUrls: jest.fn(async (bucket: string, paths: string[]) =>
        Object.fromEntries(
          paths
            .filter((path) => stored.has(`${bucket} ${path}`))
            .map((path) => [path, `https://signed.test/${bucket}/${path}`]),
        ),
      ),
    } as unknown as IStorageProvider;
    const reportRepo = new SupabaseChatMessageReportRepository(harness.client);
    const unused = {} as never;
    chat = new ChatService(
      { findById: jest.fn(async () => ({ id: CHANNEL })) } as never,
      unused,
      {
        findById: jest.fn(async (id: string) => messages.get(id) ?? null),
      } as never,
      unused,
      new SupabaseChatMessageAttachmentRepository(harness.client),
      unused,
      unused,
      unused,
      storage,
      unused,
      unused,
      unused,
      unused,
      unused,
      reportRepo,
    );
    const channelAccess = {
      assertMessageAccess: jest.fn(async (id: string) => messages.get(id)),
    } as unknown as ChannelAccessService;
    const rbac = {
      findUserIdsWithPermissions: jest.fn(async () => [OFFICER]),
    } as unknown as RbacService;
    const notifications = {
      notifyUser: jest.fn(async () => undefined),
    } as unknown as NotificationService;
    reports = new ChatReportService(
      reportRepo,
      channelAccess,
      chat,
      rbac,
      notifications,
    );
  });

  it("keeps a reported photo through its sender's delete, serves it to the officer, and deletes it when the report resolves", async () => {
    const filed = await reports.fileReport(CHAPTER_A, REPORTER, {
      message_id: REPORTED,
      reason: 'sexual',
    });
    expect(filed.reported_attachments).toEqual([
      { filename: 'photo.png', content_type: 'image/png', byte_size: 2048 },
    ]);

    await senderDeletes(REPORTED);
    expect(stored.has(`chat ${PHOTO}`)).toBe(true);

    const evidence = await reports.listReportEvidence(
      filed.id,
      CHAPTER_A,
      OFFICER,
    );
    expect(evidence).toEqual([
      {
        filename: 'photo.png',
        content_type: 'image/png',
        byte_size: 2048,
        download_url: `https://signed.test/chat/${PHOTO}`,
      },
    ]);

    await reports.resolveReport(filed.id, CHAPTER_A, 'actioned', OFFICER);

    expect(stored.has(`chat ${PHOTO}`)).toBe(false);
    const [row] = harness
      .rows('chat_message_reports')
      .filter(({ id }) => id === filed.id);
    expect(row.evidence_released_at).not.toBeNull();
    await expect(
      reports.listReportEvidence(filed.id, CHAPTER_A, OFFICER),
    ).rejects.toThrow(ConflictException);
  });

  it('deletes nothing when a report over a live message is dismissed, and the later delete purges', async () => {
    const filed = await reports.fileReport(CHAPTER_A, REPORTER, {
      message_id: REPORTED,
      reason: 'spam',
    });

    await reports.resolveReport(filed.id, CHAPTER_A, 'dismissed', OFFICER);
    expect(stored.has(`chat ${PHOTO}`)).toBe(true);

    await senderDeletes(REPORTED);
    expect(stored.has(`chat ${PHOTO}`)).toBe(false);
  });

  it("still purges an unreported message's attachment on delete", async () => {
    await reports.fileReport(CHAPTER_A, REPORTER, {
      message_id: REPORTED,
      reason: 'sexual',
    });

    await senderDeletes(UNREPORTED);

    expect(stored.has(`chat ${OTHER}`)).toBe(false);
    expect(stored.has(`chat ${PHOTO}`)).toBe(true);
  });
});
