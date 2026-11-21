// Reminder queries (#4957) against a real PostgREST, for what the unit specs
// can't see: that the message embed resolves with a bookmark's column list,
// that the (user_id, message_id) upsert moves a reminder and clears its
// fired_at against the live constraint, and that the sweep's claim is a real
// compare-and-set: it wins once, and loses when the time moved after the read.
//
// Run: `npm run test:integration -w apps/api` (needs a local Supabase stack;
// skips cleanly without one). Not run by CI, like its siblings (#1568).

import { randomUUID } from 'node:crypto';
import { SupabaseChatMessageReminderRepository } from '../../src/infrastructure/supabase/repositories/supabase-chat-message-reminder.repository';
import type { FrappSupabaseClient } from '../../src/infrastructure/supabase/database.types';
import { createServiceRoleClient, describeIntegration } from './stack';

describeIntegration('Reminder queries against live PostgREST', () => {
  let supabase: FrappSupabaseClient;
  let repo: SupabaseChatMessageReminderRepository;

  const chapterId = randomUUID();
  const userId = randomUUID();
  const otherUserId = randomUUID();
  const channelId = randomUUID();
  const messageId = randomUUID();
  const laterMessageId = randomUUID();

  const assertOk = (label: string, error: { message: string } | null) => {
    if (error) throw new Error(`seed ${label}: ${error.message}`);
  };
  const minutesFromNow = (minutes: number) =>
    new Date(Date.now() + minutes * 60_000).toISOString();

  beforeAll(async () => {
    supabase = createServiceRoleClient();
    assertOk(
      'chapters',
      (
        await supabase.from('chapters').insert({
          id: chapterId,
          name: `rem-${chapterId.slice(0, 8)}`,
          university: 'Integration Test University',
        } as never)
      ).error,
    );
    assertOk(
      'users',
      (
        await supabase.from('users').insert([
          {
            id: userId,
            supabase_auth_id: randomUUID(),
            email: `rem-${userId}@example.test`,
            display_name: 'Rem One',
          },
          {
            id: otherUserId,
            supabase_auth_id: randomUUID(),
            email: `rem-${otherUserId}@example.test`,
            display_name: 'Rem Two',
          },
        ] as never)
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
    assertOk(
      'chat_messages',
      (
        await supabase.from('chat_messages').insert([
          {
            id: messageId,
            channel_id: channelId,
            sender_id: otherUserId,
            content: 'dues are due Friday',
            type: 'TEXT',
            is_deleted: false,
          },
          {
            id: laterMessageId,
            channel_id: channelId,
            sender_id: otherUserId,
            content: 'bring the banner',
            type: 'TEXT',
            is_deleted: false,
          },
        ] as never)
      ).error,
    );
    repo = new SupabaseChatMessageReminderRepository(supabase);
  });

  afterAll(async () => {
    if (!supabase) return;
    await supabase
      .from('chat_message_reminders')
      .delete()
      .eq('chapter_id', chapterId);
    await supabase
      .from('chat_messages')
      .delete()
      .in('id', [messageId, laterMessageId]);
    await supabase.from('chat_channels').delete().eq('id', channelId);
    await supabase.from('users').delete().in('id', [userId, otherUserId]);
    await supabase.from('chapters').delete().eq('id', chapterId);
  });

  it('sets one reminder per member per message, and setting it again moves it and clears fired_at', async () => {
    const first = await repo.upsert(
      userId,
      messageId,
      chapterId,
      minutesFromNow(-1),
    );
    expect(await repo.claimDue(first, new Date().toISOString())).toBe(true);

    const moved = await repo.upsert(
      userId,
      messageId,
      chapterId,
      minutesFromNow(60),
    );
    expect(moved.id).toBe(first.id);
    expect(moved.fired_at).toBeNull();
    expect(new Date(moved.remind_at).getTime()).toBeGreaterThan(Date.now());
  });

  it('lists the caller’s own reminders soonest first, each with its message', async () => {
    await repo.upsert(userId, laterMessageId, chapterId, minutesFromNow(120));
    // Someone else's reminder on the same message is never in the caller's list.
    await repo.upsert(otherUserId, messageId, chapterId, minutesFromNow(5));

    const rows = await repo.findByUserAndChapter(
      userId,
      chapterId,
      new Date().toISOString(),
      50,
    );

    expect(rows.map((row) => row.message_id)).toEqual([
      messageId,
      laterMessageId,
    ]);
    expect(rows[0].message).toEqual(
      expect.objectContaining({
        id: messageId,
        channel_id: channelId,
        sender_id: otherUserId,
        content: 'dues are due Friday',
        is_deleted: false,
      }),
    );
  });

  it('finds a due reminder and claims it once; a claim on a time that moved loses', async () => {
    const due = await repo.upsert(
      otherUserId,
      messageId,
      chapterId,
      minutesFromNow(-2),
    );
    const found = await repo.findDue(new Date().toISOString(), 500);
    const read = found.find((row) => row.id === due.id);
    expect(read).toBeDefined();
    expect(read!.message.content).toBe('dues are due Friday');

    const at = new Date().toISOString();
    expect(await repo.claimDue(read!, at)).toBe(true);
    expect(await repo.claimDue(read!, at)).toBe(false);

    // Moved after the sweep read it: the stale claim must not fire it.
    const stale = await repo.upsert(
      otherUserId,
      messageId,
      chapterId,
      minutesFromNow(-1),
    );
    await repo.upsert(otherUserId, messageId, chapterId, minutesFromNow(30));
    expect(await repo.claimDue(stale, new Date().toISOString())).toBe(false);
  });

  it('clears only the caller’s own reminder', async () => {
    await repo.delete(userId, messageId, chapterId);
    const mine = await repo.findByUserAndChapter(
      userId,
      chapterId,
      new Date().toISOString(),
      50,
    );
    const theirs = await repo.findByUserAndChapter(
      otherUserId,
      chapterId,
      new Date().toISOString(),
      50,
    );
    expect(mine.map((row) => row.message_id)).toEqual([laterMessageId]);
    expect(theirs.map((row) => row.message_id)).toEqual([messageId]);
  });
});
