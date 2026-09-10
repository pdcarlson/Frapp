/**
 * Mobile UI copy and write-gating on top of the shared connection state
 * machine (`@repo/validation`, `spec/ui/resilience/connection-state.md`).
 *
 * `deriveConnectionState` lives in the shared package so web and mobile
 * cannot disagree about when a member is ONLINE / DEGRADED / OFFLINE.
 * `monitor.ts` owns the effects that feed it.
 *
 * ## The spec is written against a browser
 *
 * Detection Logic spells its rules with `navigator.onLine`, which React Native
 * does not define — reading it returns `undefined`, and `undefined === false`
 * is `false`, so a naive port reports permanently online. `lib/chat/network-state.ts`
 * documents that failure at length, having already been bitten by it. The link
 * half of the input therefore comes from `isConnected === false` (see
 * `monitor.ts`), which is the mobile equivalent of that clause. Do not fold
 * `isInternetReachable` into OFFLINE here — that is suspicion, and `/health`
 * settles it.
 */

import type { ConnectionState } from "@repo/validation";

export {
  DEGRADED_THRESHOLD,
  deriveConnectionState,
} from "@repo/validation";
export type { ConnectionInput, ConnectionState } from "@repo/validation";

/**
 * Banner copy, verbatim from `spec/ui/resilience/connection-state.md` — minus the leading
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
 * The UI Indicators table says write actions are "Disabled with tooltip: 'Reconnect to make
 * changes'" when OFFLINE. That rule holds only where a failed write is *lost*.
 * It must not be applied to the chat composer: `sendMessage` enqueues to the
 * outbox and returns before touching the network, so gating it would defeat the
 * queue built to make composing-while-offline work (see the comment above the
 * composer in `app/(tabs)/chat-thread.tsx`). Surfaces with a queue label; the
 * rest disable. `spec/ui/resilience/connection-state.md` records the split.
 */
export function writeBlockedReason(state: ConnectionState): string | null {
  return state === "OFFLINE" ? "Reconnect to make changes." : null;
}
