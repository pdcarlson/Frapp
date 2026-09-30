// Chat report evidence against a real PostgREST (#2724).
//
// `chat-report.service.spec.ts` proves the snapshot is *built* with a poll's
// options. What only a real database can answer is that it *survives*: that
// the row the report repository writes keeps the option text once the poll is
// soft-deleted, which in the unit suites is a mock returning what it was given.
// So this file files the report from the message row PostgREST returns, applies
// the write `ChatService.softDeleteMessage` makes, and reads the officer queue
// back.
//
// Run: `npm run test:integration -w apps/api` (needs a local Supabase stack;
// skips cleanly without one). Not run by CI today (#1568), like the other
// integration suites.

import { randomUUID } from 'node:crypto';
import { reportedContentSnapshot } from '../../src/application/services/chat-report.service';
import { tombstoneMetadata } from '../../src/application/services/chat.service';
import { SupabaseChatMessageReportRepository } from '../../src/infrastructure/supabase/repositories/supabase-chat-message-report.repository';
import { SupabaseChatMessageRepository } from '../../src/infrastructure/supabase/repositories/supabase-chat-message.repository';
import type { FrappSupabaseClient } from '../../src/infrastructure/supabase/database.types';
import { createServiceRoleClient, describeIntegration } from './stack';

describeIntegration('Chat report evidence against live PostgREST', () => {
  let supabase: FrappSupabaseClient;
  let messages: SupabaseChatMessageRepository;
  let reports: SupabaseChatMessageReportRepository;

  const chapterId = randomUUID();
  const authorId = randomUUID();
  const reporterId = randomUUID();
  const officerId = randomUUID();
  const channelId = randomUUID();
  const pollId = randomUUID();

  // Surfaced, never swallowed: a seed insert that fails quietly reads as "no
  // rows came back", which is what a broken query looks like too.
  const assertOk = (label: string, error: { message: string } | null) => {
    if (error) throw new Error(`seed ${label}: ${error.message}`);
  };

  beforeAll(async () => {
    supabase = createServiceRoleClient();
    messages = new SupabaseChatMessageRepository(supabase);
    reports = new SupabaseChatMessageReportRepository(supabase);

    assertOk(
      'chapters',
      (
        await supabase.from('chapters').insert({
          id: chapterId,
          name: `cr-${chapterId.slice(0, 8)}`,
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
            email: `cr-${id}@example.test`,
            display_name: `Cr ${i}`,
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
          name: 'general',
          type: 'PUBLIC',
        } as never)
      ).error,
    );
    // The shape the web client's `/poll` posts (chat-core `dispatchPoll`).
    assertOk(
      'chat_messages',
      (
        await supabase.from('chat_messages').insert({
          id: pollId,
          channel_id: channelId,
          sender_id: authorId,
          content: 'Where should we eat?',
          type: 'TEXT',
          kind: 'poll',
          payload: {
            question: 'Where should we eat?',
            options: [
              { id: 'a', label: 'Pizza' },
              { id: 'b', label: 'something harassing' },
            ],
            closes_at: '2099-01-01T00:00:00.000Z',
          },
          is_deleted: false,
        } as never)
      ).error,
    );
  });

  afterAll(async () => {
    if (!supabase) return;
    await supabase
      .from('chat_message_reports')
      .delete()
      .eq('chapter_id', chapterId);
    await supabase.from('chat_messages').delete().eq('id', pollId);
    await supabase.from('chat_channels').delete().eq('id', channelId);
    await supabase
      .from('users')
      .delete()
      .in('id', [authorId, reporterId, officerId]);
    await supabase.from('chapters').delete().eq('id', chapterId);
  });

  it("keeps a reported poll's option text after its author deletes the poll", async () => {
    const poll = await messages.findById(pollId);
    expect(poll).not.toBeNull();

    // What `ChatReportService.fileReport` writes, from the row it authorized.
    const { created } = await reports.create({
      chapter_id: chapterId,
      message_id: pollId,
      reporter_user_id: reporterId,
      reported_content: reportedContentSnapshot(poll!),
      reported_sender_id: poll!.sender_id,
      reported_author_name: poll!.author_name ?? null,
      reported_attachments: [],
      reason: 'harassment',
      details: null,
    });
    expect(created).toBe(true);

    // The author's delete: exactly the write `softDeleteMessage` makes.
    await messages.update(pollId, {
      content: '[message deleted]',
      is_deleted: true,
      metadata: tombstoneMetadata(poll!),
    });
    const tombstone = await messages.findById(pollId);
    expect(tombstone).toMatchObject({
      is_deleted: true,
      content: '[message deleted]',
    });

    const [report] = await reports.findByChapterAndStatus(
      chapterId,
      'open',
      officerId,
    );
    expect(report.message_id).toBe(pollId);
    expect(report.reported_content).toBe(
      'Where should we eat?\n- Pizza\n- something harassing',
    );
  });
});
