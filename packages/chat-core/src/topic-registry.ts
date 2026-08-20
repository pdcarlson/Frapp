/**
 * Topic-registry helpers shared by every Supabase Realtime attach path.
 *
 * Moved here from `apps/web/lib/realtime/topic-registry.ts` with the chat
 * extraction (#937 S3). That web re-export shim was deleted in #1099; web
 * now imports this module directly (`@repo/chat-core/topic-registry`) —
 * `apps/web/lib/realtime/supabase-realtime.ts` and everything on
 * `useRealtimeTable`, plus the chat manager in this package, share this one
 * implementation. The #817 invariant is enforced by imports instead of a
 * lockstep comment.
 *
 * Why freeing a topic matters: `RealtimeClient.channel(topic)` hands back the
 * *existing* instance while one is still registered under `realtime:<topic>`,
 * and `removeChannel()` only calls `teardown()` — the step that actually
 * unregisters it — when `unsubscribe()` resolves `"ok"`. So a cleanup
 * immediately followed by a re-attach on the same topic gets the old,
 * already-subscribed channel back. That reuse fails two distinct ways:
 *
 *   - a reused `joined`/`joining` instance makes `.on("postgres_changes", …)`
 *     **throw** (`RealtimeChannel.on`) — which took the dashboard shell down in
 *     #783, and reaches every `useRealtimeTable` consumer per #817; and
 *   - a reused `leaving`/`errored` instance throws nothing but never delivers a
 *     row, so the subscription looks attached and stays silent.
 *
 * Both callers therefore free a topic before minting on it.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/** The client registers channels under a `realtime:` prefix. */
function registryTopic(topic: string): string {
  return `realtime:${topic}`;
}

/**
 * Is anything still registered under this topic?
 *
 * This is the difference between minting a fresh channel and silently getting
 * the old one back, so callers use it to decide whether to pay for a teardown
 * at all — a first join is the common case and stays synchronous.
 */
export function isTopicOccupied(
  client: SupabaseClient,
  topic: string,
): boolean {
  const wanted = registryTopic(topic);
  return client.getChannels().some((channel) => channel.topic === wanted);
}

/**
 * Frees a topic so the next `client.channel(topic)` mints a genuinely new
 * instance.
 *
 * Tearing down unconditionally is what makes this airtight: it is precisely the
 * step `removeChannel()` skips when `unsubscribe()` resolves anything other
 * than `"ok"`.
 *
 * `unsubscribe()` resolves rather than rejects and is bounded by the client's
 * own timeout, so this cannot wedge a re-attach.
 */
export async function releaseTopic(
  client: SupabaseClient,
  topic: string,
): Promise<void> {
  const wanted = registryTopic(topic);
  // `getChannels()` returns the client's live array and teardown mutates it,
  // so iterate a snapshot.
  for (const channel of [...client.getChannels()]) {
    if (channel.topic !== wanted) continue;
    try {
      await channel.unsubscribe();
    } catch {
      // Already gone, or the socket is down — teardown below is what counts.
    }
    try {
      channel.teardown();
    } catch {
      // Already torn down.
    }
  }
}
