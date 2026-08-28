/**
 * The one place mobile decides whether the app is ONLINE, DEGRADED or OFFLINE.
 *
 * A module singleton rather than a provider, for the reason every app-wide
 * runtime in this app is one: `app/_layout.tsx` is a frozen hotspot file
 * (`spec/ui/mobile/navigation.md` § Hotspot freeze). `components/app-runtime.tsx`
 * starts it; `use-connection.ts` is how components read it.
 *
 * Mirrors `apps/web/lib/providers/network-provider.tsx` — same 30s poll, same
 * 5s probe timeout, same three-consecutive-failure threshold — with two
 * deliberate differences:
 *
 * 1. **The link signal is `expo-network`, not `navigator.onLine`.** React Native
 *    defines `navigator` but never sets `onLine`, so the browser probe reports
 *    permanently online on device. `lib/chat/network-state.ts` documents that
 *    trap at length; `isOfflineFromExpoState` is the single reading of
 *    `expo-network` the chat outbox already trusts, and reusing it means the
 *    banner and the outbox cannot disagree about what "offline" means.
 * 2. **Three failed probes mean OFFLINE, not DEGRADED.** `spec/ui/resilience.md`
 *    § 2 is explicit: "'OFFLINE': !navigator.onLine OR health check to /health
 *    fails 3 times", with DEGRADED reserved for slow or intermittent. The web
 *    provider maps that same threshold to DEGRADED and never reaches OFFLINE
 *    from probing at all, so the two surfaces genuinely disagree today. This
 *    follows the spec; the web divergence is filed rather than fixed from a
 *    mobile slice.
 *
 * ## `/health` is not under `/v1`
 *
 * It is the one route that is not, so the poll needs the bare origin. That is
 * the same normalization the SDK applies to its own `baseUrl`, so it comes from
 * the shared helper rather than a second local copy of the rule — the two
 * drifting apart is what once let a doubled `/v1` 404 every data request while
 * the health poll kept reporting ONLINE (see the web provider's comment).
 */

import {
  addNetworkStateListener,
  getNetworkStateAsync,
  type NetworkState as ExpoNetworkState,
} from "expo-network";
import { normalizeApiBaseUrl } from "@repo/api-sdk";
import { deriveConnectionState, type ConnectionState } from "./state";

export const HEALTH_POLL_INTERVAL_MS = 30_000;
export const HEALTH_TIMEOUT_MS = 5_000;

export function healthUrl(): string | null {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL;
  if (!apiUrl) return null;
  return `${normalizeApiBaseUrl(apiUrl)}/health`;
}

export interface ConnectionMonitor {
  get(): ConnectionState;
  subscribe(listener: (state: ConnectionState) => void): () => void;
  /** Idempotent: safe to call from every mount of the runtime component. */
  start(): void;
  stop(): void;
  /** Test seam — runs one probe cycle synchronously from the caller's await. */
  probeOnce(): Promise<void>;
}

export interface MonitorDeps {
  getState: typeof getNetworkStateAsync;
  addListener: typeof addNetworkStateListener;
  fetch: typeof fetch;
  setInterval: (fn: () => void, ms: number) => ReturnType<typeof setInterval>;
  clearInterval: (handle: ReturnType<typeof setInterval>) => void;
}

const defaultDeps: MonitorDeps = {
  getState: getNetworkStateAsync,
  addListener: addNetworkStateListener,
  fetch: (...args) => fetch(...args),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (handle) => clearInterval(handle),
};

export function createConnectionMonitor(
  deps: MonitorDeps = defaultDeps,
): ConnectionMonitor {
  const listeners = new Set<(state: ConnectionState) => void>();

  // Optimistic until proven otherwise, matching the `NetworkState` port's
  // "unknown counts as online" contract: a false offline strands writes.
  let linkOffline = false;
  let consecutiveFailures = 0;
  let state: ConnectionState = "ONLINE";

  let started = false;
  /**
   * Whether a listener event has already told us the link state.
   *
   * `start()` kicks off an async `getState()` read *and* subscribes. The read
   * resolves a microtask or two later, so a listener event that fires in
   * between would be overwritten by a snapshot taken before it — the monitor
   * would report the older truth and, worse, un-set an offline it had just been
   * told about. The listener always wins once it has spoken.
   */
  let linkFromListener = false;
  let poll: ReturnType<typeof setInterval> | null = null;
  let unsubscribeLink: (() => void) | null = null;

  function publish() {
    const next = deriveConnectionState({ linkOffline, consecutiveFailures });
    if (next === state) return;
    state = next;
    // Copy first: a listener that unsubscribes itself would otherwise mutate
    // the set mid-iteration (the same guard `lib/auth-token.ts` uses).
    for (const listener of [...listeners]) listener(state);
  }

  /**
   * Only a **missing link** is definitive.
   *
   * `lib/chat/network-state.ts`'s `isOfflineFromExpoState` ORs `isConnected ===
   * false` with `isInternetReachable === false`, and that is right *for the
   * outbox*: a false "offline" there only means "queue instead of send", which
   * costs nothing. It is wrong here, because this value gates writes. A chapter
   * house whose captive-portal validation probe is blocked reports
   * `{isConnected: true, isInternetReachable: false}` while the API is perfectly
   * reachable — folding that into OFFLINE would disable the check-in code field
   * at the door with no way to recover, since the early return below also stops
   * `/health` from ever proving otherwise.
   *
   * So a false `isInternetReachable` is treated as *suspicion*, not proof: it
   * counts as one probe failure, and `/health` gets to settle it. That is also
   * what `spec/ui/resilience.md` § 2 actually says — `!navigator.onLine` is the
   * OFFLINE clause; "intermittently failing" is DEGRADED.
   */
  function applyLink(next: ExpoNetworkState) {
    const nextOffline = next.isConnected === false;
    const unreachable = next.isInternetReachable === false;

    // Reset only on a genuine offline → online **transition**. `expo-network`
    // fires on every path update — a cell handoff, a VPN toggle, a Wi-Fi↔LTE
    // switch — so resetting on each event meant a moving device could never
    // accumulate three failures, and an API outage would never reach the
    // banner at all.
    const cameBack = linkOffline && !nextOffline;
    linkOffline = nextOffline;
    linkFromListener = true;
    if (cameBack) consecutiveFailures = 0;
    if (!nextOffline && unreachable) consecutiveFailures += 1;

    publish();
    // A transition is exactly when the answer is most likely stale.
    if (cameBack) void probeOnce();
  }

  async function probeOnce() {
    // No link: the answer is already known and a probe would only burn a
    // request and up to 5s to reach it.
    if (linkOffline) return;

    const url = healthUrl();
    if (!url) {
      // No API configured (local dev without env). Nothing to be degraded
      // about — do not paint a banner over a missing variable.
      consecutiveFailures = 0;
      publish();
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
    try {
      const response = await deps.fetch(url, {
        method: "GET",
        signal: controller.signal,
      });
      if (response.ok) consecutiveFailures = 0;
      else consecutiveFailures += 1;
    } catch {
      consecutiveFailures += 1;
    } finally {
      clearTimeout(timeout);
    }
    publish();
  }

  return {
    get: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start() {
      if (started) return;
      started = true;

      void deps
        .getState()
        .then((state) => {
          // Superseded by a listener event that arrived while this was in
          // flight — see `linkFromListener`.
          if (linkFromListener) return;
          applyLink(state);
        })
        .catch(() => {
          // Keep the optimistic default; an unreadable link state is not an
          // outage.
        });

      const subscription = deps.addListener(applyLink);
      unsubscribeLink = () => subscription.remove();

      // Probe immediately, not just on the first interval tick. Without this a
      // cold start against a dead API reports ONLINE for a full poll period
      // before the first failure even lands, and OFFLINE needs three — two
      // minutes of an app that says everything is fine while nothing loads.
      void probeOnce();
      poll = deps.setInterval(() => void probeOnce(), HEALTH_POLL_INTERVAL_MS);
    },
    stop() {
      started = false;
      linkFromListener = false;
      unsubscribeLink?.();
      unsubscribeLink = null;
      if (poll !== null) deps.clearInterval(poll);
      poll = null;
    },
    probeOnce,
  };
}

/** One per app process — the banner, the write gates and TanStack all read it. */
export const connectionMonitor = createConnectionMonitor();
