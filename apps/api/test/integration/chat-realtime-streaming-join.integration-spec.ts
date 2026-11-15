// What chat-core's realtime manager relies on `postgres_changes_options.wait`
// for, asked of a real Realtime server (#5022).
//
// Without `wait`, Realtime reports `SUBSCRIBED` once a channel has joined,
// which can come before the replication behind its `postgres_changes` is
// streaming; the manager treats `SUBSCRIBED` as "every row from here on
// arrives" (a thread's gap-recovery read, the inbox's `joined`), so it joins
// its thread and inbox channels with `wait: true` (`STREAMING_JOIN` in
// `packages/chat-core/src/realtime-manager.ts`). That only closes the window
// if the server honours the option instead of ignoring it, and a server that
// honours it refuses a join it can't stream rather than reporting it
// subscribed. Both are checked here; `realtime-subscribed-window.spec.ts` in
// chat-core checks the manager's side against a fake server.
//
// The window itself shows only on the first join after Realtime starts, so it
// can't be reproduced reliably from a test: `docker restart` the Realtime
// container, then join without `wait` and write a row straight after
// `SUBSCRIBED`. On local Realtime v2.130.0 that row was missed three times out
// of three, and with `wait` caught two of two.
//
// Run: `npm run test:integration -w apps/api` (needs a local Supabase stack;
// skips cleanly without one). Not run by CI today (#1568), like the rest of
// this suite.

import { randomUUID } from 'node:crypto';
import {
  createClient,
  REALTIME_SUBSCRIBE_STATES,
  type SupabaseClient,
} from '@supabase/supabase-js';
import type { FrappSupabaseClient } from '../../src/infrastructure/supabase/database.types';
import {
  createServiceRoleClient,
  describeIntegration,
  readCredentials,
} from './stack';

type Outcome = { status: string; error?: string };

const WAIT = { wait: true, timeout: 3000 } as const;

describeIntegration('Chat realtime: a `wait` join means streaming', () => {
  let db: FrappSupabaseClient;
  const clients: SupabaseClient[] = [];

  const chapterId = randomUUID();
  const userId = randomUUID();
  const channelId = randomUUID();

  /** A fresh client per join, so no join rides a channel another one warmed. */
  const freshClient = (): SupabaseClient => {
    const creds = readCredentials()!;
    const client = createClient(creds.url, creds.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    clients.push(client);
    return client;
  };

  const assertOk = (label: string, error: { message: string } | null) => {
    if (error) throw new Error(`seed ${label}: ${error.message}`);
  };

  beforeAll(async () => {
    db = createServiceRoleClient();
    assertOk(
      'chapters',
      (
        await db.from('chapters').insert({
          id: chapterId,
          name: `wait-${chapterId.slice(0, 8)}`,
          university: 'Integration Test University',
        } as never)
      ).error,
    );
    assertOk(
      'users',
      (
        await db.from('users').insert({
          id: userId,
          supabase_auth_id: randomUUID(),
          email: `wait-${userId}@example.test`,
          display_name: 'Wait Writer',
        } as never)
      ).error,
    );
    assertOk(
      'chat_channels',
      (
        await db.from('chat_channels').insert({
          id: channelId,
          chapter_id: chapterId,
          name: 'general',
          type: 'PUBLIC',
        } as never)
      ).error,
    );
  });

  afterAll(async () => {
    for (const client of clients) {
      await client.removeAllChannels();
      client.realtime.disconnect();
    }
    if (!db) return;
    await db.from('chat_messages').delete().eq('channel_id', channelId);
    await db.from('chat_channels').delete().eq('id', channelId);
    await db.from('users').delete().eq('id', userId);
    await db.from('chapters').delete().eq('id', chapterId);
  });

  it('refuses a `wait` join it cannot stream, where a plain join reports SUBSCRIBED', async () => {
    // `chapters` is not in the `supabase_realtime` publication.
    const join = (wait: boolean) =>
      new Promise<Outcome>((resolve) => {
        freshClient()
          .channel(`wait-check:${wait}:${randomUUID()}`, {
            config: wait ? { postgres_changes_options: WAIT } : {},
          })
          .on(
            'postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'chapters' },
            () => undefined,
          )
          .subscribe((status, err) => {
            if (status !== REALTIME_SUBSCRIBE_STATES.CLOSED) {
              resolve({ status, error: err?.message });
            }
          });
      });

    expect((await join(false)).status).toBe('SUBSCRIBED');
    const refused = await join(true);
    expect(refused.status).toBe('CHANNEL_ERROR');
    expect(refused.error).toMatch(/RealtimeDisabledForConfiguration/);
  }, 30_000);

  it('delivers a message written straight after a `wait` SUBSCRIBED', async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const id = randomUUID();
      const received = new Promise<string>((resolve) => {
        const channel = freshClient().channel(`wait-stream:${randomUUID()}`, {
          config: { postgres_changes_options: WAIT },
        });
        channel.on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'chat_messages',
            filter: `channel_id=eq.${channelId}`,
          },
          (payload) => {
            const row = payload.new as { id?: string };
            if (row.id === id) resolve(id);
          },
        );
        channel.subscribe((status) => {
          if (status !== REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) return;
          void db
            .from('chat_messages')
            .insert({
              id,
              channel_id: channelId,
              sender_id: userId,
              content: `attempt ${attempt}`,
              type: 'TEXT',
              is_deleted: false,
            } as never)
            .then(({ error }) => assertOk('chat_messages', error));
        });
      });
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<string>((resolve) => {
        timer = setTimeout(() => resolve('missed'), 5_000);
      });

      const outcome = await Promise.race([received, timeout]);
      clearTimeout(timer);
      expect(outcome).toBe(id);
    }
  }, 60_000);
});
