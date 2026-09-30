// A reported attachment survives its sender's delete (#2481), against a real
// PostgREST and a real storage-api.
//
// The unit suites prove what `ChatService` and the report repository *ask*
// for. What only a live stack answers is that the questions work: that the
// `reported_attachments` jsonb round-trips, that the hold read (`neq.[]` on a
// jsonb column) finds the object an open report names, that the purge then
// really leaves the bytes in the bucket and the officer's signed URL serves
// them, and that the release deletes them once the report resolves. So this
// drives the real `ChatService` evidence methods over the real repositories
// and `SupabaseStorageService`, and applies the same soft-delete write
// `ChatService.softDeleteMessage` makes.
//
// Run: `npm run test:integration -w apps/api` (needs a local Supabase stack;
// skips cleanly without one). Not run by CI today (#1568), like the other
// integration suites.

import { randomUUID } from 'node:crypto';
import { ChatService } from '../../src/application/services/chat.service';
import { SupabaseChatMessageAttachmentRepository } from '../../src/infrastructure/supabase/repositories/supabase-chat-message-attachment.repository';
import { SupabaseChatMessageReportRepository } from '../../src/infrastructure/supabase/repositories/supabase-chat-message-report.repository';
import { SupabaseChatMessageRepository } from '../../src/infrastructure/supabase/repositories/supabase-chat-message.repository';
import { SupabaseStorageService } from '../../src/infrastructure/storage/supabase-storage.service';
import type { FrappSupabaseClient } from '../../src/infrastructure/supabase/database.types';
import { createServiceRoleClient, describeIntegration } from './stack';

const BUCKET = 'chat';

describeIntegration('Reported attachments against live storage', () => {
  let supabase: FrappSupabaseClient;
  let storage: SupabaseStorageService;
  let messages: SupabaseChatMessageRepository;
  let reports: SupabaseChatMessageReportRepository;
  let chat: ChatService;

  const chapterId = randomUUID();
  const authorId = randomUUID();
  const reporterId = randomUUID();
  const officerId = randomUUID();
  const channelId = randomUUID();
  const reportedId = randomUUID();
  const unreportedId = randomUUID();
  const folder = `chapters/${chapterId}/chat/${channelId}`;
  const reportedPath = `${folder}/${randomUUID()}/photo.png`;
  const unreportedPath = `${folder}/${randomUUID()}/other.png`;
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);

  const assertOk = (label: string, error: { message: string } | null) => {
    if (error) throw new Error(`seed ${label}: ${error.message}`);
  };

  /** A message with one uploaded attachment, as a send leaves it. */
  async function seedMessage(id: string, path: string): Promise<void> {
    await storage.uploadFile(BUCKET, path, bytes, 'image/png');
    assertOk(
      'chat_messages',
      (
        await supabase.from('chat_messages').insert({
          id,
          channel_id: channelId,
          sender_id: authorId,
          content: '',
          type: 'TEXT',
          is_deleted: false,
        } as never)
      ).error,
    );
    assertOk(
      'chat_message_attachments',
      (
        await supabase.from('chat_message_attachments').insert({
          message_id: id,
          channel_id: channelId,
          bucket: BUCKET,
          storage_path: path,
          filename: path.split('/').pop(),
          content_type: 'image/png',
          byte_size: bytes.length,
        } as never)
      ).error,
    );
  }

  /** The write `ChatService.softDeleteMessage` makes, then its purge. */
  async function senderDeletes(id: string): Promise<void> {
    await messages.update(id, {
      content: '[message deleted]',
      is_deleted: true,
      metadata: {},
    });
    await chat.purgeRemovedMessageAttachments(id, chapterId);
  }

  beforeAll(async () => {
    supabase = createServiceRoleClient();
    storage = new SupabaseStorageService(supabase);
    messages = new SupabaseChatMessageRepository(supabase);
    reports = new SupabaseChatMessageReportRepository(supabase);
    const unused = {} as never;
    chat = new ChatService(
      unused,
      unused,
      messages,
      unused,
      new SupabaseChatMessageAttachmentRepository(supabase),
      unused,
      unused,
      unused,
      storage,
      unused,
      unused,
      unused,
      unused,
      unused,
      reports,
    );

    assertOk(
      'chapters',
      (
        await supabase.from('chapters').insert({
          id: chapterId,
          name: `ev-${chapterId.slice(0, 8)}`,
          university: 'Integration Test University',
        } as never)
      ).error,
    );
    assertOk(
      'users',
      (
        await supabase.from('users').insert(
          [authorId, reporterId, officerId].map((id, i) => ({
            id,
            supabase_auth_id: randomUUID(),
            email: `ev-${id}@example.test`,
            display_name: `Ev ${i}`,
          })) as never,
        )
      ).error,
    );
    assertOk(
      'chat_channels',
      (
        await supabase.from('chat_channels').insert({
          id: channelId,
          chapter_id: chapterId,
          name: 'dm-evidence',
          type: 'PUBLIC',
        } as never)
      ).error,
    );
    await seedMessage(reportedId, reportedPath);
    await seedMessage(unreportedId, unreportedPath);
  });

  afterAll(async () => {
    if (!supabase) return;
    await storage
      .deleteFiles(BUCKET, [reportedPath, unreportedPath])
      .catch(() => undefined);
    await supabase
      .from('chat_message_reports')
      .delete()
      .eq('chapter_id', chapterId);
    await supabase
      .from('chat_messages')
      .delete()
      .in('id', [reportedId, unreportedId]);
    await supabase.from('chat_channels').delete().eq('id', channelId);
    await supabase
      .from('users')
      .delete()
      .in('id', [authorId, reporterId, officerId]);
    await supabase.from('chapters').delete().eq('id', chapterId);
  });

  it('keeps a reported photo through its sender’s delete, serves it to the officer, and deletes it once the report resolves', async () => {
    // Filed: the snapshot is read from the message's attachment rows.
    const snapshot = await chat.reportedAttachmentsSnapshot(
      reportedId,
      chapterId,
    );
    expect(snapshot).toEqual([
      {
        bucket: BUCKET,
        storage_path: reportedPath,
        filename: 'photo.png',
        content_type: 'image/png',
        byte_size: bytes.length,
      },
    ]);
    const { report } = await reports.create({
      chapter_id: chapterId,
      message_id: reportedId,
      reporter_user_id: reporterId,
      reported_content: '',
      reported_sender_id: authorId,
      reported_author_name: null,
      reported_attachments: snapshot,
      reason: 'sexual',
      details: null,
    });
    // The queue sees the file's name and size, never its location.
    expect(report.reported_attachments).toEqual([
      { filename: 'photo.png', content_type: 'image/png', byte_size: 8 },
    ]);
    expect(await reports.findHeldObjects(chapterId)).toEqual([
      {
        bucket: BUCKET,
        storage_path: reportedPath,
        heldOpen: true,
        pendingSince: null,
      },
    ]);

    // The sender deletes it. The open report holds the object.
    await senderDeletes(reportedId);
    expect(await storage.downloadFile(BUCKET, reportedPath)).not.toBeNull();

    // The officer can still open it, through the report.
    const evidence = await reports.findEvidence(
      report.id,
      chapterId,
      officerId,
    );
    expect(evidence?.status).toBe('open');
    const signed = await chat.signReportEvidence(
      report.id,
      evidence?.reported_attachments ?? [],
    );
    expect(signed).toHaveLength(1);
    const served = await fetch(signed[0].download_url);
    expect(served.status).toBe(200);
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(bytes);

    // Resolved: until its release finishes the report still holds, the way a
    // removal's claim does. Then the release deletes it, and the stamp ends
    // the hold and takes it off the sweep.
    const resolvedAt = new Date().toISOString();
    await reports.resolve(
      report.id,
      chapterId,
      'actioned',
      officerId,
      resolvedAt,
    );
    const held = await reports.findHeldObjects(chapterId);
    expect(held).toEqual([
      {
        bucket: BUCKET,
        storage_path: reportedPath,
        heldOpen: false,
        pendingSince: expect.any(String),
      },
    ]);
    // Postgres answers in its own timestamp format; the instant is the same.
    expect(Date.parse(held[0].pendingSince ?? '')).toBe(Date.parse(resolvedAt));
    const [pending] = await reports.findPendingRelease(chapterId, [report.id]);
    expect(pending?.reported_attachments).toEqual(snapshot);
    await expect(
      chat.releaseReportEvidence(
        chapterId,
        [pending],
        new Date(Date.now() - 15 * 60 * 1000),
      ),
    ).resolves.toEqual(new Set([report.id]));
    await reports.markEvidenceReleased(report.id, chapterId, resolvedAt);

    expect(await storage.downloadFile(BUCKET, reportedPath)).toBeNull();
    expect(await reports.findHeldObjects(chapterId)).toEqual([]);
    expect(await reports.findPendingRelease(chapterId, [report.id])).toEqual(
      [],
    );
  });

  it('still purges an unreported message’s attachment on delete', async () => {
    await senderDeletes(unreportedId);

    expect(await storage.downloadFile(BUCKET, unreportedPath)).toBeNull();
  });
});
