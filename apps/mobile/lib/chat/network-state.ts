/**
 * `NetworkState` for React Native.
 *
 * Production chat injects `createMonitorNetworkState(connectionMonitor)` —
 * one `expo-network` subscription (the monitor's) plus the `/health` poll.
 * `createExpoNetworkState` remains the documented RN trap and the pin in
 * `adapters.spec.ts`: omitting `net` silently falls back to
 * `browserNetworkState`, whose probe is:
 *
 * ```ts
 * typeof navigator !== "undefined" && navigator.onLine === false
 * ```
 *
 * React Native defines a `navigator` global but no `onLine` property, so that
 * expression evaluates `undefined === false` → `false`: the browser adapter
 * reports **permanently online** on device. Every offline gate in `chat-core`
 * reads through this port, so the failure is not a missing signal but an
 * actively wrong one.
 *
 * The port is synchronous; both adapters cache. Unknown counts as **online** —
 * a false "offline" would strand sends in the outbox.
 */

import {
  addNetworkStateListener,
  getNetworkStateAsync,
  type NetworkState as ExpoNetworkState,
} from "expo-network";
import type { NetworkState } from "@repo/chat-core/adapters";
import type { ConnectionMonitor } from "@/lib/connection/monitor";

export interface PrimeableNetworkState extends NetworkState {
  /** Reads the current connectivity once, to seed the cache before first use. */
  prime(): Promise<void>;
}

/**
 * `expo-network` reports `isConnected` (a link exists) and
 * `isInternetReachable` (traffic actually gets out). Treat offline as "we have
 * a definite negative": either field explicitly `false`. `undefined` on either
 * — which is what an unsupported platform returns — stays online.
 */
export function isOfflineFromExpoState(state: ExpoNetworkState): boolean {
  return state.isConnected === false || state.isInternetReachable === false;
}

export function createExpoNetworkState(
  deps: {
    getState: typeof getNetworkStateAsync;
    addListener: typeof addNetworkStateListener;
  } = {
    getState: getNetworkStateAsync,
    addListener: addNetworkStateListener,
  },
): PrimeableNetworkState {
  let offline = false;

  return {
    async prime() {
      try {
        offline = isOfflineFromExpoState(await deps.getState());
      } catch {
        // Keep the optimistic default — see the module comment on why a false
        // "offline" is the worse error.
      }
    },

    isOffline() {
      return offline;
    },

    subscribe(onChange) {
      const subscription = deps.addListener((state) => {
        const nextOffline = isOfflineFromExpoState(state);
        if (nextOffline === offline) return;
        offline = nextOffline;
        // The port's callback signals `online`, not `offline`.
        onChange(!nextOffline);
      });
      return () => subscription.remove();
    },
  };
}

/**
 * Chat `NetworkState` backed by the process connection monitor (#1072).
 *
 * One `expo-network` subscription for the app (the monitor's). `isOffline()`
 * is the monitor's OFFLINE — link down, or three failed `/health` probes —
 * so a dead API with the link up queues instead of POSTing a failed bubble,
 * and a health recovery with no link flip still emits `online=true` for
 * `flushOutbox`. `DEGRADED` is not offline: a slow or once-failed probe
 * must still send.
 *
 * `prime()` starts the monitor (idempotent). Unknown stays online, matching
 * the port contract and the monitor's own optimistic default.
 */
export function createMonitorNetworkState(
  monitor: Pick<ConnectionMonitor, "get" | "subscribe" | "start">,
): PrimeableNetworkState {
  return {
    async prime() {
      monitor.start();
    },

    isOffline() {
      return monitor.get() === "OFFLINE";
    },

    subscribe(onChange) {
      let lastOffline = monitor.get() === "OFFLINE";
      return monitor.subscribe((state) => {
        const nextOffline = state === "OFFLINE";
        if (nextOffline === lastOffline) return;
        lastOffline = nextOffline;
        onChange(!nextOffline);
      });
    },
  };
}
