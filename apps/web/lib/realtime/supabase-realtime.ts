"use client";

import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { isTopicOccupied, releaseTopic } from "@/lib/realtime/topic-registry";

/**
 * Singleton browser Supabase client for realtime subscriptions.
 *
 * `createSupabaseBrowserClient()` is safe to call many times — it returns a
 * fresh client each call — but Supabase Realtime multiplexes topics over one
 * websocket per client. Reusing a single client keeps us from opening an
 * extra websocket per subscribed hook (chat + notifications + attendance
 * live views would otherwise stack three connections).
 *
 * The client is created lazily on the first hook invocation so server-side
 * rendering never constructs it. We tolerate the Playwright visual-regression
 * environment where Supabase env vars are stand-ins by simply letting the
 * websocket fail to connect — the `isConnected` gate on subscribing hooks
 * prevents errors from cascading into the UI.
 */

let cachedClient: SupabaseClient | null = null;

export function getRealtimeClient(): SupabaseClient {
  if (cachedClient) return cachedClient;
  cachedClient = createSupabaseBrowserClient();
  return cachedClient;
}

/**
 * Serializes every attach and release for a given topic.
 *
 * Freeing a topic is asynchronous (`unsubscribe()` before `teardown()`) but a
 * `useEffect` cleanup is synchronous, so an effect re-run hands us a release
 * and the next attach in the same tick. Running those concurrently is its own
 * bug: the release would iterate the registry *after* the successor had already
 * minted its channel on that topic and tear the live one down. Chaining them
 * per topic makes the ordering the obvious one — a release always completes
 * before the attach queued behind it starts.
 *
 * Keyed by bare topic, so unrelated topics never wait on each other.
 */
const topicOperations = new Map<string, Promise<void>>();

function enqueue(topic: string, operation: () => Promise<void>): Promise<void> {
  const previous = topicOperations.get(topic) ?? Promise.resolve();
  // `previous` is already terminated with a `catch`, so it never rejects and a
  // failed operation cannot stall the ones queued behind it.
  const next = previous.then(operation).catch((error: unknown) => {
    // Contained deliberately: every caller is a React effect, and a rejection
    // escaping into a commit phase is exactly how #783 unmounted the shell.
    // Logged rather than swallowed because the alternative failure is silent —
    // a subscription that never attaches looks identical to an idle one.
    console.warn(`realtime: topic "${topic}" operation failed`, error);
  });
  topicOperations.set(topic, next);
  void next.then(() => {
    // Drop the entry once it is settled and still the tail, so a long-lived
    // session does not accumulate one promise per topic it ever visited.
    if (topicOperations.get(topic) === next) topicOperations.delete(topic);
  });
  return next;
}

/**
 * Wraps `supabase.channel(topic).subscribe()` with a consistent unsubscribe
 * path. Call from a `useEffect` to attach Postgres-changes handlers and
 * return the returned cleanup function.
 *
 * The channel is minted on the topic queue rather than inline, so an effect
 * re-run on an *unchanged* topic — which `useRealtimeTable` does whenever
 * `event`, `invalidateKey` or `queryClient` changes, and which React
 * StrictMode does on every dev mount — cannot get the previous, already
 * subscribed instance back and throw out of `configure()` (#817).
 */
export function attachRealtimeChannel(
  topic: string,
  configure: (channel: RealtimeChannel) => RealtimeChannel,
): () => void {
  const client = getRealtimeClient();
  let detached = false;
  let attached: RealtimeChannel | null = null;

  void enqueue(topic, async () => {
    if (detached) return;
    if (isTopicOccupied(client, topic)) {
      await releaseTopic(client, topic);
      // Cleanup can land while the release is in flight; the queued release
      // below would then have nothing to undo, so stop here instead.
      if (detached) return;
    }
    const channel = configure(client.channel(topic));
    attached = channel;
    channel.subscribe();
  });

  return () => {
    detached = true;
    void enqueue(topic, async () => {
      // Null when the attach never ran (cleanup overtook it) or already
      // released — either way there is nothing registered to free.
      if (!attached) return;
      attached = null;
      await releaseTopic(client, topic);
    });
  };
}
