"use client";

import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  attachTopicChannel,
  type TopicAttachOptions,
} from "@repo/chat-core/topic-attach";

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
 * Wraps `supabase.channel(topic).subscribe()` with a consistent unsubscribe
 * path. Call from a `useEffect` to attach Postgres-changes handlers and
 * return the returned cleanup function.
 *
 * The channel is minted on the topic queue rather than inline, so an effect
 * re-run on an *unchanged* topic — which `useRealtimeTable` does whenever
 * `event`, `invalidateKey` or `queryClient` changes, and which React
 * StrictMode does on every dev mount — cannot get the previous, already
 * subscribed instance back and throw out of `configure()` (#817).
 *
 * The queue and the attach live in `@repo/chat-core/topic-attach` (#3929), so
 * mobile's change-ping subscription shares them; this binds web's client.
 */
export function attachRealtimeChannel(
  topic: string,
  configure: (channel: RealtimeChannel) => RealtimeChannel,
  options: TopicAttachOptions = {},
): () => void {
  return attachTopicChannel(getRealtimeClient(), topic, configure, options);
}
