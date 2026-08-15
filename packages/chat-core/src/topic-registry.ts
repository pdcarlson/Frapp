/**
 * Fallback `TopicRegistry`, used when `ManagerContext.topics` is not injected.
 *
 * LOCKSTEP COPY — `apps/web/lib/realtime/topic-registry.ts` is canonical. The
 * registry cannot move here because the non-chat realtime attach path
 * (`lib/realtime/supabase-realtime.ts`) shares it, and a package must not
 * import the app back. The web chat glue injects that canonical module
 * (`chat-provider.tsx`), so exactly one implementation is live in the web
 * bundle (#817's invariant); this copy serves the package's own tests and
 * platforms that have no registry of their own. Both are stateless over the
 * client's channel registry — **if you edit one, edit the other.**
 *
 * Why freeing a topic matters (condensed from the canonical header):
 * `RealtimeClient.channel(topic)` hands back the *existing* instance while one
 * is still registered under `realtime:<topic>`, and `removeChannel()` only
 * calls `teardown()` — the step that actually unregisters — when
 * `unsubscribe()` resolves `"ok"`. A cleanup immediately followed by a
 * re-attach therefore gets the old channel back: a `joined`/`joining` reuse
 * makes `.on("postgres_changes", …)` throw (#783), and a `leaving`/`errored`
 * reuse attaches silently and never delivers a row. Callers free the topic
 * before minting on it.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { TopicRegistry } from "./adapters";

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
function isTopicOccupied(client: SupabaseClient, topic: string): boolean {
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
async function releaseTopic(client: SupabaseClient, topic: string): Promise<void> {
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

export const defaultTopicRegistry: TopicRegistry = {
  isTopicOccupied,
  releaseTopic,
};
