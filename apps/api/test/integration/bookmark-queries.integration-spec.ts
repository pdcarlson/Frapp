// Bookmark queries against a real PostgREST.
//
// `supabase-chat-message-bookmark.repository.spec.ts` proves the repository
// *filters* correctly. It cannot prove PostgREST would accept the request that
// produced a row: the tenant-scope harness explicitly "ignores the select()
// projection" and "does not resolve joins", so `message` in that suite is
// whatever the fixture wrote onto the bookmark row. Every assertion there about
// the embed — including the one this feature cares most about, that a deleted
// message keeps surfacing its `[message deleted]` placeholder — is an assertion
// about the fixture.
//
// That is the same gap #746 lived in, which is why this file exists beside
// `report-queries.integration-spec.ts` rather than as more unit tests. What
// only a real server can answer: that `message:chat_messages!inner(...)`
// resolves at all, that the column list names columns that exist, that
// `user_id` really is absent from what the repository returns, and that the
// `(user_id, message_id)` upsert is genuinely idempotent against the live
// constraint rather than against a fake that reimplements it.
//
// Run: `npm run test:integration -w apps/api` (needs a local Supabase stack;
// skips cleanly without one).

import { randomUUID } from 'node:crypto';
import { SupabaseChatMessageBookmarkRepository } from '../../src/infrastructure/supabase/repositories/supabase-chat-message-bookmark.repository';
import type { FrappSupabaseClient } from '../../src/infrastructure/supabase/database.types';
import { createServiceRoleClient, describeIntegration } from './stack';

describeIntegration('Bookmark queries against live PostgREST', () => {
  let supabase: FrappSupabaseClient;
  let repo: SupabaseChatMessageBookmarkRepository;

  const chapterId = randomUUID();
  const otherChapterId = randomUUID();
  const userId = randomUUID();
  const otherUserId = randomUUID();
  const channelId = randomUUID();
  const otherChannelId = randomUUID();
  const liveMessageId = randomUUID();
  const deletedMessageId = randomUUID();
  const otherChapterMessageId = randomUUID();
  /** Bookmarked by `otherUserId` only — the privacy probe. */
  const otherUsersMessageId = randomUUID();

  // Surfaced, never swallowed. A seed insert that fails quietly turns every
  // assertion below into "no rows came back", which is exactly what a broken
  // query looks like — the first draft of this file omitted the NOT NULL
  // `supabase_auth_id` and reported seven failures that all blamed the query.
  const assertOk = (label: string, error: { message: string } | null) => {
    if (error) throw new Error(`seed ${label}: ${error.message}`);
  };

  beforeAll(async () => {
    supabase = createServiceRoleClient();

    // Two chapters with deliberately overlapping data, matching the report
    // fixture's rationale: the same user bookmarks in both, so a query that
    // lost its chapter filter produces visibly wrong rows rather than fewer.
    assertOk(
      'chapters',
      (
        await supabase.from('chapters').insert([
          {
            id: chapterId,
            name: `bm-primary-${chapterId.slice(0, 8)}`,
            university: 'Integration Test University',
          },
          {
            id: otherChapterId,
            name: `bm-other-${otherChapterId.slice(0, 8)}`,
            university: 'Integration Test University',
          },
        ] as never)
      ).error,
    );
    assertOk(
      'users',
      (
        await supabase.from('users').insert([
          {
            id: userId,
            supabase_auth_id: randomUUID(),
            email: `bm-${userId}@example.test`,
            display_name: 'Bm One',
          },
          {
            id: otherUserId,
            supabase_auth_id: randomUUID(),
            email: `bm-${otherUserId}@example.test`,
            display_name: 'Bm Two',
          },
        ] as never)
      ).error,
    );
    assertOk(
      'chat_channels',
      (
        await supabase.from('chat_channels').insert([
          {
            id: channelId,
            chapter_id: chapterId,
            name: 'general',
            type: 'PUBLIC',
          },
          {
            id: otherChannelId,
            chapter_id: otherChapterId,
            name: 'general',
            type: 'PUBLIC',
          },
        ] as never)
      ).error,
    );
    assertOk(
      'chat_messages',
      (
        await supabase.from('chat_messages').insert([
          {
            id: liveMessageId,
            channel_id: channelId,
            sender_id: userId,
            content: 'the dues link',
            type: 'TEXT',
            is_deleted: false,
          },
          {
            id: deletedMessageId,
            channel_id: channelId,
            sender_id: userId,
            // Exactly what `ChatService.deleteMessage` writes.
            content: '[message deleted]',
            is_deleted: true,
            type: 'TEXT',
          },
          {
            id: otherChapterMessageId,
            channel_id: otherChannelId,
            sender_id: userId,
            content: 'other chapter',
            type: 'TEXT',
            is_deleted: false,
          },
          {
            id: otherUsersMessageId,
            channel_id: channelId,
            sender_id: otherUserId,
            content: 'saved by somebody else',
            type: 'TEXT',
            is_deleted: false,
          },
        ] as never)
      ).error,
    );

    repo = new SupabaseChatMessageBookmarkRepository(supabase);
  });

  afterAll(async () => {
    if (!supabase) return;
    await supabase
      .from('chat_message_bookmarks')
      .delete()
      .in('chapter_id', [chapterId, otherChapterId]);
    await supabase
      .from('chat_messages')
      .delete()
      .in('id', [
        liveMessageId,
        deletedMessageId,
        otherChapterMessageId,
        otherUsersMessageId,
      ]);
    await supabase
      .from('chat_channels')
      .delete()
      .in('id', [channelId, otherChannelId]);
    await supabase.from('users').delete().in('id', [userId, otherUserId]);
    await supabase
      .from('chapters')
      .delete()
      .in('id', [chapterId, otherChapterId]);
  });

  it('resolves the message embed — the column list names columns that exist', async () => {
    // The assertion the unit suite structurally cannot make. A renamed or
    // dropped column in `CHAT_MESSAGE_COLUMNS` fails here with a PostgREST 400
    // instead of in production.
    await repo.create(userId, liveMessageId, chapterId);

    const rows = await repo.findByUserAndChapter(userId, chapterId);

    expect(rows).toHaveLength(1);
    expect(rows[0].message).toBeTruthy();
    expect(rows[0].message.id).toBe(liveMessageId);
    expect(rows[0].message.content).toBe('the dues link');
    expect(rows[0].message.channel_id).toBe(channelId);
  });

  it('keeps a bookmark whose message was deleted, carrying the placeholder', async () => {
    // The acceptance criterion, proved against the real join rather than
    // against a value the test itself wrote. Adding `.eq('is_deleted', false)`
    // makes this fail; in the unit suite it would not.
    await repo.create(userId, deletedMessageId, chapterId);

    const rows = await repo.findByUserAndChapter(userId, chapterId);
    const deleted = rows.find((r) => r.message_id === deletedMessageId);

    expect(deleted).toBeDefined();
    expect(deleted?.message.is_deleted).toBe(true);
    expect(deleted?.message.content).toBe('[message deleted]');
  });

  it('never returns user_id', async () => {
    await repo.create(userId, liveMessageId, chapterId);

    const rows = await repo.findByUserAndChapter(userId, chapterId);

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row).not.toHaveProperty('user_id');
    }
  });

  it('is idempotent against the live unique constraint', async () => {
    // The upsert's conflict target has to match the real index. A fake that
    // reimplements dedupe would pass whatever target were named.
    const first = await repo.create(userId, liveMessageId, chapterId);
    const second = await repo.create(userId, liveMessageId, chapterId);

    expect(second.id).toBe(first.id);
    expect(second.created_at).toBe(first.created_at);

    const { count } = await supabase
      .from('chat_message_bookmarks')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('message_id', liveMessageId);
    expect(count).toBe(1);
  });

  it('does not return another chapter bookmarks', async () => {
    await repo.create(userId, liveMessageId, chapterId);
    await repo.create(userId, otherChapterMessageId, otherChapterId);

    const rows = await repo.findByUserAndChapter(userId, chapterId);

    expect(rows.map((r) => r.message_id)).not.toContain(otherChapterMessageId);
  });

  it('does not return another member bookmarks in the same chapter', async () => {
    // The privacy guarantee, against a real server. Same chapter, same channel,
    // a message this caller never bookmarked — only the `user_id` predicate
    // keeps the other member's row out, and nothing else in the stack would
    // notice if it were dropped.
    await repo.create(otherUserId, otherUsersMessageId, chapterId);

    const rows = await repo.findByUserAndChapter(userId, chapterId);

    expect(rows.map((r) => r.message_id)).not.toContain(otherUsersMessageId);

    // ...and the row really is there to be leaked, so the assertion above is
    // not passing merely because the insert failed.
    const { count } = await supabase
      .from('chat_message_bookmarks')
      .select('id', { count: 'exact', head: true })
      .eq('message_id', otherUsersMessageId);
    expect(count).toBe(1);
  });

  it('deletes only within the given chapter', async () => {
    await repo.create(userId, otherChapterMessageId, otherChapterId);

    // Right user and message, wrong chapter — must not match.
    await repo.delete(userId, otherChapterMessageId, chapterId);

    const stillThere = await repo.findByUserAndChapter(userId, otherChapterId);
    expect(stillThere.map((r) => r.message_id)).toContain(
      otherChapterMessageId,
    );
  });
});
