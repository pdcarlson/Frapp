"use client";

import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

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
 * Wraps `supabase.channel(topic).subscribe()` with a consistent unsubscribe
 * path. Call from a `useEffect` to attach Postgres-changes handlers and
 * return the returned cleanup function.
 */
export function attachRealtimeChannel(
  topic: string,
  configure: (channel: RealtimeChannel) => RealtimeChannel,
): () => void {
  const client = getRealtimeClient();
  const channel = configure(client.channel(topic));
  channel.subscribe();
  return () => {
    try {
      void client.removeChannel(channel);
    } catch {
      // Swallow — cleanup must never throw during React unmount.
    }
  };
}
