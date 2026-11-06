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
 *    trap at length. The chat outbox is a `NetworkState` adapter over this
 *    monitor (#1072): one `expo-network` subscription, one `/health` poll.
 *    `DEGRADED` still sends; only OFFLINE queues.
 * 2. **Three failed probes mean OFFLINE, not DEGRADED.** `spec/ui/resilience/connection-state.md`
 *    is explicit: "'OFFLINE': !navigator.onLine OR health check to /health
 *    fails 3 times", with DEGRADED reserved for slow or intermittent. Both
 *    surfaces call the same `deriveConnectionState` in `@repo/validation`; a
 *    429 is reachability, not a failure (`healthProbeIsReachable`).
 *
 * ## A link drop is confirmed, and a backgrounded app is not evidence
 *
 * Both rules come from a false "You're offline" banner after a lock and unlock
 * on Android (0.9.0 (2), 2026-11-04), with the phone online the whole time:
 *
 * - **Background readings are discarded.** `expo-network` builds every Android
 *   event from `ConnectivityManager.getActiveNetwork()`, which "will return null
 *   when there is no default network, *or when the default network is blocked*"
 *   (Android reference). Android blocks a backgrounded app's network under Doze,
 *   app standby and battery saver, so a capability change that fires while the
 *   screen is off reads as `isConnected: false`. `expo-network` has no
 *   `onBlockedStatusChanged` handler, so nothing re-emits when the block lifts,
 *   and the monitor used to skip every probe while the link read as down. The
 *   app came back to the foreground OFFLINE and stayed there until some later
 *   network event happened to fire. A `/health` probe cut off by the suspension
 *   also counted as a failure. So the monitor now ignores link events and probe
 *   results while the app is in the background, and on return to the
 *   foreground re-reads the link and probes at once. That first probe gets one
 *   retry (`CONFIRM_RETRY_MS`) before a failure counts, because the first request
 *   after a long Doze can time out while the radio wakes.
 * - **A link drop waits `LINK_DOWN_GRACE_MS`, then asks `/health`.** A Wi-Fi
 *   network that re-associates on wake, or a Wi-Fi to cellular handoff,
 *   reports no network for a second or two. Any "link up" event inside the
 *   grace cancels it, and probes wait for the verdict rather than counting a
 *   failure the drop already explains. When the grace runs out, one probe
 *   confirms it: with no link it fails at once and the banner shows.
 * - **A successful probe clears a down link.** `/health` answering proves the
 *   device can reach the API, whatever the last link event said, so the poll
 *   keeps probing while the link reads as down. That is the way back when
 *   `expo-network` never reports the recovery, and the only way back: a
 *   link-up event alone leaves OFFLINE in place until the probe answers, as
 *   the spec's recovery edge says.
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
import { AppState, type AppStateStatus } from "react-native";
import { normalizeApiBaseUrl, withRequestIdInit } from "@repo/api-sdk";
import { CONFIRM_RETRY_MS, healthProbeIsReachable } from "@repo/validation";
import { deriveConnectionState, type ConnectionState } from "./state";

export const HEALTH_POLL_INTERVAL_MS = 30_000;
export const HEALTH_TIMEOUT_MS = 5_000;
/**
 * How long `isConnected: false` must stand before the monitor calls it
 * OFFLINE. Long enough to cover a Wi-Fi network re-associating after the
 * screen comes on, or a Wi-Fi to cellular handoff; short enough that a real
 * drop still reaches the banner and the chat outbox within a few seconds.
 */
export const LINK_DOWN_GRACE_MS = 3_000;
/** Re-exported for the specs; the rule and its reasons live in `@repo/validation`. */
export { CONFIRM_RETRY_MS };

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

type TimerHandle = ReturnType<typeof setTimeout>;

export interface MonitorDeps {
  getState: typeof getNetworkStateAsync;
  addListener: typeof addNetworkStateListener;
  fetch: typeof fetch;
  setInterval: (fn: () => void, ms: number) => ReturnType<typeof setInterval>;
  clearInterval: (handle: ReturnType<typeof setInterval>) => void;
  /** The link-down grace timer. */
  setTimeout: (fn: () => void, ms: number) => TimerHandle;
  clearTimeout: (handle: TimerHandle) => void;
  /** Foreground and background, from `AppState`. */
  appState: {
    readonly currentState: AppStateStatus | null | undefined;
    addEventListener(
      type: "change",
      listener: (state: AppStateStatus) => void,
    ): { remove(): void };
  };
}

const defaultDeps: MonitorDeps = {
  getState: getNetworkStateAsync,
  addListener: addNetworkStateListener,
  fetch: (...args) => fetch(...args),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (handle) => clearInterval(handle),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle),
  appState: AppState,
};

/**
 * `background` only. `inactive` is iOS Control Center, the app switcher and a
 * notification-shade pull: the app is still running and its network is not
 * blocked, so those readings stay trustworthy. `query-connectivity.ts` and
 * `app/(tabs)/study.tsx` draw the same line.
 */
function isBackground(state: AppStateStatus | null | undefined): boolean {
  return state === "background";
}

export function createConnectionMonitor(
  overrides: Partial<MonitorDeps> = {},
): ConnectionMonitor {
  const deps: MonitorDeps = { ...defaultDeps, ...overrides };
  const listeners = new Set<(state: ConnectionState) => void>();

  // Optimistic until proven otherwise, matching the `NetworkState` port's
  // "unknown counts as online" contract: a false offline strands writes.
  let linkOffline = false;
  let consecutiveFailures = 0;
  let probeGeneration = 0;
  /** The generation of the probe in flight, if it still counts. */
  let inFlightGeneration: number | null = null;
  /** Whether this poll interval has spent its suspicion probe. */
  let suspicionProbed = false;
  /**
   * Bumped by `stop()`, so an async `getState()` read that resolves after it
   * cannot schedule a timer, probe or publish on a stopped monitor.
   */
  let lifecycle = 0;
  let state: ConnectionState = "ONLINE";

  let started = false;
  /** In the background: link events and probe results are not evidence. */
  let suspended = false;
  /**
   * Counts listener events, so a `getState()` read can tell it was overtaken.
   *
   * `start()` and the return to the foreground each kick off an async
   * `getState()` read *and* listen. The read resolves a microtask or two later,
   * so a listener event that fires in between would be overwritten by a
   * snapshot taken before it — the monitor would report the older truth and,
   * worse, un-set an offline it had just been told about. The listener always
   * wins once it has spoken.
   */
  let linkEvents = 0;
  /** A link drop waiting out `LINK_DOWN_GRACE_MS`. */
  let pendingLinkDown: TimerHandle | null = null;
  /** The retry of a failed first probe after the foreground. */
  let confirmRetry: TimerHandle | null = null;
  let poll: ReturnType<typeof setInterval> | null = null;
  let unsubscribeLink: (() => void) | null = null;
  let unsubscribeAppState: (() => void) | null = null;

  function publish() {
    const next = deriveConnectionState({ linkOffline, consecutiveFailures });
    if (next === state) return;
    state = next;
    // Copy first: a listener that unsubscribes itself would otherwise mutate
    // the set mid-iteration (the same guard `lib/auth-token.ts` uses).
    for (const listener of [...listeners]) listener(state);
  }

  /** Drops the probe in flight: whatever it reports, it reports on old news. */
  function discardInFlightProbe() {
    probeGeneration += 1;
    inFlightGeneration = null;
  }

  function cancelPendingLinkDown(): boolean {
    if (pendingLinkDown === null) return false;
    deps.clearTimeout(pendingLinkDown);
    pendingLinkDown = null;
    return true;
  }

  /**
   * Only a **missing link** is definitive, and only once it has stood for
   * `LINK_DOWN_GRACE_MS`.
   *
   * `isInternetReachable === false` is suspicion, not proof — the same rule
   * the chat outbox inherits, because it reads this monitor (#1072). Folding it
   * into OFFLINE would disable the check-in code field at the door for a
   * captive-portal-ish network whose API is perfectly reachable. It does not
   * count as a failure either: Android reports it for every network that has
   * not finished validating, which includes every network that has just
   * reconnected, and one event per capability change used to add one failure
   * each, so a reconnect alone could reach three. It asks `/health`, and
   * `/health` settles it (`spec/ui/resilience/connection-state.md`).
   */
  function applyLink(next: ExpoNetworkState) {
    if (!started || suspended) return;

    if (next.isConnected === false) {
      if (linkOffline || pendingLinkDown !== null) return;
      // The drop explains any failure the probe in flight is about to report.
      discardInFlightProbe();
      pendingLinkDown = deps.setTimeout(() => {
        pendingLinkDown = null;
        // Not published yet: `/health` confirms it first. With no link the
        // probe fails at once and publishes OFFLINE; an answer means the
        // reading was wrong (a network still blocked for this app, say) and
        // the banner never shows.
        linkOffline = true;
        void probeOnce();
      }, LINK_DOWN_GRACE_MS);
      return;
    }

    // Do not reset the failure count on a link event. `expo-network` fires
    // on every path update — a cell handoff, a VPN toggle, a Wi-Fi↔LTE
    // switch — so resetting on each of those meant a moving device could
    // never accumulate three failures. Resetting on a genuine
    // offline→online transition is the same class of bug the web provider
    // dropped: a link is not a reachable API, and flashing ONLINE while
    // `/health` is still dead re-enables writes. Probe; a reachable
    // response is what clears the count (`spec/ui/resilience/connection-state.md`).
    //
    // For the same reason a confirmed link drop stays OFFLINE when the link
    // returns: the spec's way out of OFFLINE is "link back AND a /health probe
    // succeeds", and only the probe clears `linkOffline`. Clearing it here
    // would show ONLINE, or "Slow connection" from failures the down-link
    // polls left behind, before the API has said anything.
    const cameBack = linkOffline;
    const blip = cancelPendingLinkDown();

    if (cameBack || blip) {
      // A fresh probe, never the one in flight: that one was sent while the
      // link was down (or was discarded by the blip), and its failure is not
      // news about the API now that the link is back.
      void probeOnce();
      return;
    }
    if (next.isInternetReachable === false) askAboutSuspicion();
  }

  /**
   * One extra probe per poll interval for `isInternetReachable === false`.
   *
   * Not one per event: Android emits several while a reconnected network
   * validates, and if `/health` fails fast in that window a probe per event
   * would reach three failures in under a second. The three-failure threshold
   * exists so that one bad moment is not an outage.
   */
  function askAboutSuspicion() {
    if (suspicionProbed) return;
    if (inFlightGeneration === probeGeneration) return;
    suspicionProbed = true;
    void probeOnce();
  }

  function cancelConfirmRetry() {
    if (confirmRetry === null) return;
    deps.clearTimeout(confirmRetry);
    confirmRetry = null;
  }

  async function probeOnce({ afterWake = false, retried = false } = {}) {
    if (!started || suspended) return;
    // Wait for the link-drop verdict: a probe now would fail for a reason the
    // drop already explains and count it against the API.
    if (pendingLinkDown !== null) return;

    const url = healthUrl();
    if (!url) {
      // No API configured (local dev without env). Nothing to be degraded
      // about — do not paint a banner over a missing variable.
      consecutiveFailures = 0;
      publish();
      return;
    }

    // Probed even while the link reads as down. With no link the request
    // fails at once, and a reachable answer is the only way back when
    // `expo-network` never reports the recovery (see the file doc).
    const generation = ++probeGeneration;
    inFlightGeneration = generation;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
    let reachable = false;
    try {
      const response = await deps.fetch(
        url,
        withRequestIdInit({
          method: "GET",
          signal: controller.signal,
        }),
      );
      reachable = healthProbeIsReachable(response);
    } catch {
      reachable = false;
    } finally {
      clearTimeout(timeout);
    }
    if (generation !== probeGeneration) return;
    inFlightGeneration = null;

    if (reachable) {
      // A pending confirm has nothing left to confirm.
      cancelConfirmRetry();
      consecutiveFailures = 0;
      linkOffline = false;
    } else if (
      !retried &&
      !linkOffline &&
      (afterWake || consecutiveFailures === 0)
    ) {
      // Not counted yet: one retry first (see `CONFIRM_RETRY_MS`). A retry
      // already on its way decides; this one doesn't push it back.
      if (confirmRetry !== null) return;
      confirmRetry = deps.setTimeout(() => {
        confirmRetry = null;
        void probeOnce({ retried: true });
      }, CONFIRM_RETRY_MS);
      return;
    } else {
      // With the link down this changes nothing on screen: only a reachable
      // probe clears `linkOffline`, and it resets the count too.
      consecutiveFailures += 1;
    }
    publish();
  }

  function startPolling() {
    if (poll !== null) return;
    poll = deps.setInterval(() => {
      suspicionProbed = false;
      void probeOnce();
    }, HEALTH_POLL_INTERVAL_MS);
  }

  function stopPolling() {
    if (poll !== null) deps.clearInterval(poll);
    poll = null;
  }

  function enterBackground() {
    if (suspended) return;
    suspended = true;
    // A probe the OS cut off is not an outage, and a pending link drop was
    // most likely the OS blocking a backgrounded app. The foreground re-read
    // decides both.
    discardInFlightProbe();
    cancelPendingLinkDown();
    cancelConfirmRetry();
    stopPolling();
  }

  function enterForeground() {
    if (!suspended) return;
    suspended = false;
    // The last link event may have been read while the network was blocked
    // for this app, and nothing re-emits when the block lifts. Read it fresh,
    // then probe: the probe also clears a down link that the read gets wrong.
    // The screen keeps what it showed until the probe answers.
    const eventsBefore = linkEvents;
    const run = lifecycle;
    suspicionProbed = false;
    void deps
      .getState()
      .then((next) => {
        if (run === lifecycle && linkEvents === eventsBefore) applyLink(next);
      })
      .catch(() => {
        // Keep what we had; the probe below still settles it.
      })
      .finally(() => {
        // `probeOnce` itself skips a stopped or re-suspended monitor.
        if (run === lifecycle) void probeOnce({ afterWake: true });
      });
    startPolling();
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
      suspended = isBackground(deps.appState.currentState);

      const appStateSubscription = deps.appState.addEventListener(
        "change",
        (next) => {
          if (isBackground(next)) enterBackground();
          else if (next === "active") enterForeground();
        },
      );
      unsubscribeAppState = () => appStateSubscription.remove();

      const subscription = deps.addListener((next) => {
        linkEvents += 1;
        applyLink(next);
      });
      unsubscribeLink = () => subscription.remove();

      // Launched straight into the background (a notification, a headless
      // task): wait for the foreground, which reads and probes on its own.
      if (suspended) return;

      const eventsBefore = linkEvents;
      const run = lifecycle;
      void deps
        .getState()
        .then((state) => {
          // Superseded by a listener event that arrived while this was in
          // flight — see `linkEvents` — or by `stop()`.
          if (run !== lifecycle || linkEvents !== eventsBefore) return;
          applyLink(state);
        })
        .catch(() => {
          // Keep the optimistic default; an unreadable link state is not an
          // outage.
        });

      // Probe immediately, not just on the first interval tick. Without this a
      // cold start against a dead API reports ONLINE for a full poll period
      // before the first failure even lands, and OFFLINE needs three — two
      // minutes of an app that says everything is fine while nothing loads.
      void probeOnce();
      startPolling();
    },
    stop() {
      started = false;
      suspended = false;
      lifecycle += 1;
      discardInFlightProbe();
      cancelPendingLinkDown();
      cancelConfirmRetry();
      unsubscribeLink?.();
      unsubscribeLink = null;
      unsubscribeAppState?.();
      unsubscribeAppState = null;
      stopPolling();
    },
    probeOnce: () => probeOnce(),
  };
}

/** One per app process — the banner, the write gates and TanStack all read it. */
export const connectionMonitor = createConnectionMonitor();
