// The chat backfill's `since` read against a real PostgREST (#2807).
//
// `supabase-chat-message.repository.spec.ts` pins the same contract on the
// tenant-scope harness, whose `order()`, `limit()` and `gte()` are a fake's.
// The contract is entirely about how those three combine, so this file asks
// the real server: the page is the newest `limit` rows after the cursor,
// newest first, and a cursor that names no message in the channel is refused
// rather than ignored.
//
// Run: `npm run test:integration -w apps/api` (needs a local Supabase stack;
// skips cleanly without one). Not run by CI today (#1568), like the rest of
// this suite.

import { randomUUID } from 'node:crypto';
import { ChatMessageCursorNotFoundError } from '../../src/domain/repositories/chat.repository.interface';
import { SupabaseChatMessageRepository } from '../../src/infrastructure/supabase/repositories/supabase-chat-message.repository';
import type { FrappSupabaseClient } from '../../src/infrastructure/supabase/database.types';
import { createServiceRoleClient, describeIntegration } from './stack';

describeIntegration('Chat since read against live PostgREST', () => {
  let supabase: FrappSupabaseClient;
  let repo: SupabaseChatMessageRepository;

  const chapterId = randomUUID();
  const userId = randomUUID();
  const channelId = randomUUID();
  const otherChannelId = randomUUID();
  /** `messageIds[n]` was sent `n` seconds after the first, so higher is newer. */
  const messageIds = [1, 2, 3, 4, 5].map(() => randomUUID());
  const otherChannelMessageId = randomUUID();
  /** Sent in the same instant as `messageIds[1]`, as an imported batch can be. */
  const twinOfOne = randomUUID();

  const assertOk = (label: string, error: { message: string } | null) => {
    if (error) throw new Error(`seed ${label}: ${error.message}`);
  };
  const sentAt = (n: number) =>
    new Date(Date.UTC(2026, 0, 1) + n * 1000).toISOString();

  beforeAll(async () => {
    supabase = createServiceRoleClient();
    assertOk(
      'chapters',
      (
        await supabase.from('chapters').insert({
          id: chapterId,
          name: `since-${chapterId.slice(0, 8)}`,
          university: 'Integration Test University',
        } as never)
      ).error,
    );
    assertOk(
      'users',
      (
        await supabase.from('users').insert({
          id: userId,
          supabase_auth_id: randomUUID(),
          email: `since-${userId}@example.test`,
          display_name: 'Since Reader',
        } as never)
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
            chapter_id: chapterId,
            name: 'random',
            type: 'PUBLIC',
          },
        ] as never)
      ).error,
    );
    assertOk(
      'chat_messages',
      (
        await supabase.from('chat_messages').insert([
          ...messageIds.map((id, n) => ({
            id,
            channel_id: channelId,
            sender_id: userId,
            content: `message ${n}`,
            type: 'TEXT',
            is_deleted: false,
            created_at: sentAt(n),
          })),
          {
            id: twinOfOne,
            channel_id: channelId,
            sender_id: userId,
            content: 'twin of message 1',
            type: 'TEXT',
            is_deleted: false,
            created_at: sentAt(1),
          },
          {
            id: otherChannelMessageId,
            channel_id: otherChannelId,
            sender_id: userId,
            content: 'elsewhere',
            type: 'TEXT',
            is_deleted: false,
            created_at: sentAt(0),
          },
        ] as never)
      ).error,
    );

    repo = new SupabaseChatMessageRepository(supabase);
  });

  afterAll(async () => {
    if (!supabase) return;
    await supabase
      .from('chat_messages')
      .delete()
      .in('id', [...messageIds, twinOfOne, otherChannelMessageId]);
    await supabase
      .from('chat_channels')
      .delete()
      .in('id', [channelId, otherChannelId]);
    await supabase.from('users').delete().eq('id', userId);
    await supabase.from('chapters').delete().eq('id', chapterId);
  });

  it('returns the newest rows after the cursor, newest first, not the ones right after it', async () => {
    const rows = await repo.findByChannel(channelId, {
      since: messageIds[0],
      limit: 2,
    });

    expect(rows.map((row) => row.id)).toEqual([messageIds[4], messageIds[3]]);
  });

  it('returns everything after the cursor when it fits the page', async () => {
    const rows = await repo.findByChannel(channelId, {
      since: messageIds[2],
      limit: 50,
    });

    expect(rows.map((row) => row.id)).toEqual([messageIds[4], messageIds[3]]);
  });

  it("returns a row written in the cursor's own instant, which strictly-after would skip for good", async () => {
    const rows = await repo.findByChannel(channelId, {
      since: twinOfOne,
      limit: 50,
    });

    expect(rows.map((row) => row.id)).toEqual([
      messageIds[4],
      messageIds[3],
      messageIds[2],
      messageIds[1],
    ]);
  });

  it("refuses a cursor from another channel rather than answering with this channel's newest page", async () => {
    await expect(
      repo.findByChannel(channelId, {
        since: otherChannelMessageId,
        limit: 50,
      }),
    ).rejects.toBeInstanceOf(ChatMessageCursorNotFoundError);
  });

  it('refuses a cursor that names no message', async () => {
    await expect(
      repo.findByChannel(channelId, { since: randomUUID(), limit: 50 }),
    ).rejects.toBeInstanceOf(ChatMessageCursorNotFoundError);
  });
});
