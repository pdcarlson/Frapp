/**
 * The connection state machine from `spec/ui/resilience/connection-state.md`, as pure
 * functions.
 *
 * Shared by web (`NetworkProvider`) and mobile (`lib/connection`) so the two
 * surfaces cannot disagree about when a member is ONLINE, DEGRADED, or
 * OFFLINE. Everything here is synchronous and dependency-free; each app owns
 * the effects that feed it (browser `navigator.onLine` + `/health` poll on
 * web; `expo-network` + the same poll on mobile).
 *
 * ## Two inputs, not one
 *
 * A device link is not reachability. `navigator.onLine` / `expo-network`
 * answer "is there a link". They do not catch an API that is up, routable,
 * and failing. That is what the `/health` probe is for, and why `DEGRADED`
 * exists at all: the member is connected, the app is not working properly,
 * and saying "you're offline" would be a lie they can disprove by opening a
 * browser.
 *
 * ## 429 is reachability, not an outage
 *
 * `/health` is unauthenticated and IP-keyed. A chapter house behind one NAT
 * can 429 the anonymous bucket while authenticated `/v1` traffic still
 * succeeds. Counting that as a probe failure would take the whole house
 * OFFLINE. A 429 proves the API process is up and throttling, so it resets
 * the failure count the same way a 2xx does.
 *
 * ## What this does not model
 *
 * DEGRADED's "slow (>5s)" half in Detection Logic is unbuilt on both surfaces. Consecutive
 * probe failures are the only DEGRADED input. Do not "fix" that here by
 * inventing a duration signal the apps do not collect.
 */

/** `spec/ui/resilience/connection-state.md`. The names are the spec's, uppercase and all. */
export type ConnectionState = "ONLINE" | "DEGRADED" | "OFFLINE";

/**
 * Consecutive failed health probes before the app calls itself offline.
 *
 * Three: a single timeout on a train is not an outage, and flapping the
 * banner on every one would train members to ignore it.
 */
export const DEGRADED_THRESHOLD = 3;

/**
 * A failed probe that would be the first strike (or, on mobile, the first
 * probe after the app returns to the foreground) gets one retry after this
 * long before its failure counts. One failure is enough to show "Slow
 * connection", and one failure is what a passing blip looks like: the first
 * request after a long Doze timing out while the radio wakes, a cold start on
 * a phone still bringing its network up, an elevator. A real outage fails the
 * retry too and reaches the banner 2s later (2026-11-06, a false "Slow
 * connection" on iOS 0.9.2 over an Edit profile sheet). A reachable probe in
 * between cancels the retry, and a second failure while one is pending waits
 * for it rather than counting.
 */
export const CONFIRM_RETRY_MS = 2_000;

export interface ConnectionInput {
  /** No link: `!navigator.onLine` on web, `isConnected === false` on mobile. */
  linkOffline: boolean;
  /** Consecutive `/health` failures; reset to 0 by any reachable probe. */
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
 * Did this `/health` response prove the API is reachable?
 *
 * `ok` covers 2xx. 429 is called out because it is the one non-2xx that still
 * proves the process is up — see the file doc. A mock that only sets `ok`
 * (mobile's monitor specs) still works: missing `status` is not 429.
 */
export function healthProbeIsReachable(response: {
  ok: boolean;
  status?: number;
}): boolean {
  if (response.status === 429) return true;
  return response.ok;
}

/**
 * The open chat's realtime transport, as `@repo/chat-core` reports it. Spelled
 * out here rather than imported so this package stays dependency-free.
 */
export type RealtimeTransportStatus =
  | "live"
  | "polling"
  | "reconnecting"
  | "offline";

/** What the one connection indicator draws, or `null` for nothing. */
export interface ConnectionIndicator {
  /** `danger` for offline, `warning` for everything that still works, slowly. */
  tone: "danger" | "warning";
  /** The short label the pill draws: fits between a header's controls. */
  label: string;
  /**
   * The whole sentence: the indicator's accessible name, and what it shows
   * when the member opens it.
   */
  description: string;
}

/**
 * The single connection indicator on both surfaces
 * (`spec/ui/resilience/connection-state.md` § One indicator).
 *
 * It folds two sources into one answer, so a screen never stacks two pills,
 * or a pill and a line, saying the same thing:
 *
 * - the app's connection state (`deriveConnectionState`), which every screen
 *   has, and
 * - the realtime transport of the chat that is open, or `null` on every other
 *   screen.
 *
 * The app state wins whenever it is not ONLINE: a slow or dead API is the
 * cause, and a reconnecting or polling transport is only its symptom. Only on
 * a healthy connection does the transport get to speak, because then it is
 * the one thing wrong. With a chat open, the offline sentence also carries the
 * outbox's promise, which is true there and nowhere else.
 */
export function connectionIndicator(
  state: ConnectionState,
  realtime: RealtimeTransportStatus | null,
): ConnectionIndicator | null {
  const chatOpen = realtime !== null;
  if (state === "OFFLINE" || realtime === "offline") {
    return {
      tone: "danger",
      label: "Offline",
      description: chatOpen
        ? "You're offline. Messages you send go out when you reconnect. Photos and files need a connection."
        : "You're offline. Showing cached data.",
    };
  }
  if (state === "DEGRADED") {
    return {
      tone: "warning",
      label: "Slow connection",
      description: "Slow connection. Some features may be delayed.",
    };
  }
  if (realtime === "polling") {
    return {
      tone: "warning",
      label: "Live updates paused",
      // `spec/ui/resilience/message-delivery.md` § Receiving Messages
      // (Realtime) holds this sentence normative.
      description: "Real-time updates paused. Polling for new messages.",
    };
  }
  if (realtime === "reconnecting") {
    return {
      tone: "warning",
      label: "Reconnecting…",
      description: "Reconnecting to live updates.",
    };
  }
  return null;
}
