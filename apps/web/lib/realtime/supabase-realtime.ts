"use client";

import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { isTopicOccupied, releaseTopic } from "@repo/chat-core/topic-registry";

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
 * rendering never constructs it. We tolerate the Playwright floor-suite
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
  options: { private?: boolean } = {},
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
    // `private: true` routes the subscription through `realtime.messages` RLS,
    // which is what authorises the scoped change topics (see
    // `change-topics.ts`). A public channel on those topics would hand every
    // ping to anyone who guessed the string, so this flag is a security
    // control, not a tuning knob. The JWT it authorises against is put on the
    // socket by supabase-js itself — it calls `realtime.setAuth()` on init and
    // on every auth transition — so there is nothing to wire here.
    const channel = options.private
      ? client.channel(topic, { config: { private: true } })
      : client.channel(topic);
    // Claim it for cleanup *before* `configure` runs: the channel is already in
    // the client's registry by now, so a `configure` that throws would
    // otherwise strand it there with nothing holding a reference to release.
    attached = channel;
    configure(channel);
    // Observe the join result. `private: true` introduces an authorization step
    // that can DENY, and a denied channel is otherwise completely silent:
    // phoenix flips to `errored` and re-joins on a backoff loop for the rest of
    // the session with nothing logged and nothing shown.
    //
    // That is the same "joins, reports SUBSCRIBED, never fires" shape that hid
    // the empty-publication bug (#867) for months, so it gets a log line rather
    // than a comment. The concrete case: `activeChapterId` is persisted to
    // localStorage, so a member removed from a chapter still asks for
    // `events:<that chapter>` on their next login and is denied forever.
    channel.subscribe((status) => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        console.warn(`realtime: topic "${topic}" join ${status}`);
      }
    });
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
