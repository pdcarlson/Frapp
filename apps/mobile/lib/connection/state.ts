/**
 * The connection state machine from `spec/ui/resilience.md` § 2, as pure
 * functions.
 *
 * Everything here is synchronous and dependency-free so the rules can be
 * unit-tested without a network, a timer, or a renderer. `monitor.ts` owns the
 * effects that feed it.
 *
 * ## Two inputs, not one
 *
 * A device link is not reachability. `expo-network` answers "is there a link"
 * and, where the platform supports it, "does traffic get out" — but neither
 * catches an API that is up, routable, and failing. That is what the `/health`
 * probe is for, and why `DEGRADED` exists at all: the member is connected, the
 * app is not working properly, and saying "you're offline" would be a lie they
 * can disprove by opening a browser.
 *
 * ## The spec is written against a browser
 *
 * § 2 spells its detection rules with `navigator.onLine`, which React Native
 * does not define — reading it returns `undefined`, and `undefined === false`
 * is `false`, so a naive port reports permanently online. `lib/chat/network-state.ts`
 * documents that failure at length, having already been bitten by it. The link
 * half of the input therefore comes from `isOfflineFromExpoState`, which is the
 * mobile equivalent of that clause and already the single reading of
 * `expo-network` the chat outbox trusts.
 */

/** `spec/ui/resilience.md` § 2. The names are the spec's, uppercase and all. */
export type ConnectionState = "ONLINE" | "DEGRADED" | "OFFLINE";

/**
 * Consecutive failed health probes before the app calls itself offline.
 *
 * Three, matching `apps/web/lib/providers/network-provider.tsx` — a single
 * timeout on a train is not an outage, and flapping the banner on every one
 * would train members to ignore it.
 */
export const DEGRADED_THRESHOLD = 3;

export interface ConnectionInput {
  /** `isOfflineFromExpoState` over the latest `expo-network` read. */
  linkOffline: boolean;
  /** Consecutive `/health` failures; reset to 0 by any success. */
  consecutiveFailures: number;
}

export function deriveConnectionState({
  linkOffline,
  consecutiveFailures,
}: ConnectionInput): ConnectionState {
  // No link is unambiguous and needs no corroboration — probing would only
  // delay the banner by up to a poll interval to reach the same answer.
  if (linkOffline) return "OFFLINE";
  if (consecutiveFailures >= DEGRADED_THRESHOLD) return "OFFLINE";
  if (consecutiveFailures > 0) return "DEGRADED";
  return "ONLINE";
}

/**
 * Banner copy, verbatim from `spec/ui/resilience.md` § 2 — minus the leading
 * ⚡ / 📡.
 *
 * Those emoji are a web-era artifact of a spec written before Signet had an
 * iconography rule. `spec/ui/design-system/iconography.md` governs glyphs on
 * these surfaces and does not admit emoji, and the semantic tint already
 * carries the severity the emoji were standing in for. The spec has been
 * corrected rather than left disagreeing with what ships.
 *
 * `null` for ONLINE: there is no banner, and returning an empty string would
 * invite a caller to render an empty bar.
 */
export function connectionBannerCopy(state: ConnectionState): string | null {
  switch (state) {
    case "OFFLINE":
      return "You're offline. Showing cached data.";
    case "DEGRADED":
      return "Slow connection. Some features may be delayed.";
    case "ONLINE":
      return null;
  }
}

/**
 * Why a write control is disabled, or `null` when it is not.
 *
 * § 2's table says write actions are "Disabled with tooltip: 'Reconnect to make
 * changes'" when OFFLINE. That rule holds only where a failed write is *lost*.
 * It must not be applied to the chat composer: `sendMessage` enqueues to the
 * outbox and returns before touching the network, so gating it would defeat the
 * queue built to make composing-while-offline work (see the comment above the
 * composer in `app/(tabs)/chat-thread.tsx`). Surfaces with a queue label; the
 * rest disable. `spec/ui/resilience.md` records the split.
 */
export function writeBlockedReason(state: ConnectionState): string | null {
  return state === "OFFLINE" ? "Reconnect to make changes." : null;
}
