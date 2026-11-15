// Whether a real Realtime server honours `postgres_changes_options.wait`,
// which chat-core's realtime manager relies on (#5022).
//
// Without `wait`, Realtime reports `SUBSCRIBED` once a channel has joined,
// which can come before the replication behind its `postgres_changes` is
// streaming; the manager treats `SUBSCRIBED` as "every row from here on
// arrives" (a thread's gap-recovery read, the inbox's `joined`), so it joins
// its thread and inbox channels with `wait: true` (`STREAMING_JOIN` in
// `packages/chat-core/src/realtime-manager.ts`). That only closes the window
// if the server honours the option. A server that ignores it reports a join
// it can't stream as `SUBSCRIBED`; one that honours it refuses that join,
// which is what this checks. `realtime-subscribed-window.spec.ts` in chat-core
// checks the manager's side against a fake server.
//
// The window itself shows only on the first join after Realtime starts, so a
// test on a running stack can't reproduce it (a delivery check passes with or
// without `wait`). By hand: `docker restart` the Realtime container, then join
// without `wait` and write a row straight after `SUBSCRIBED`. On local
// Realtime v2.130.0 that row was missed three times out of three, and with
// `wait` caught two of two.
//
// Run: `npm run test:integration -w apps/api` (needs a local Supabase stack;
// skips cleanly without one). Not run by CI today (#1568), like the rest of
// this suite.

import { randomUUID } from 'node:crypto';
import { REALTIME_SUBSCRIBE_STATES } from '@supabase/supabase-js';
import type { FrappSupabaseClient } from '../../src/infrastructure/supabase/database.types';
import { createServiceRoleClient, describeIntegration } from './stack';

type Outcome = { status: string; error?: string };

describeIntegration('Chat realtime: the server honours a `wait` join', () => {
  const clients: FrappSupabaseClient[] = [];

  afterAll(async () => {
    for (const client of clients) {
      await client.removeAllChannels();
      client.realtime.disconnect();
    }
  });

  /**
   * Joins on a fresh client with a binding to `chapters`, which is not in the
   * `supabase_realtime` publication, so its stream can never start.
   */
  const joinUnstreamable = (wait: boolean) =>
    new Promise<Outcome>((resolve) => {
      const client = createServiceRoleClient();
      clients.push(client);
      client
        .channel(`wait-check:${wait}:${randomUUID()}`, {
          config: wait
            ? { postgres_changes_options: { wait: true, timeout: 3000 } }
            : {},
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

  it('reports a plain join it cannot stream as SUBSCRIBED', async () => {
    expect((await joinUnstreamable(false)).status).toBe('SUBSCRIBED');
  }, 30_000);

  it('refuses a `wait` join it cannot stream', async () => {
    const refused = await joinUnstreamable(true);
    expect(refused.status).toBe('CHANNEL_ERROR');
    expect(refused.error).toMatch(/RealtimeDisabledForConfiguration/);
  }, 30_000);
});
