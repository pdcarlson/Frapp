/**
 * `NetworkState` for React Native, backed by `expo-network`.
 *
 * **This MUST be injected.** `NetworkState` is optional on both
 * `ManagerContext` and `ChatActionContext`, and omitting it silently falls back
 * to `browserNetworkState`, whose probe is:
 *
 * ```ts
 * typeof navigator !== "undefined" && navigator.onLine === false
 * ```
 *
 * React Native defines a `navigator` global but no `onLine` property, so that
 * expression evaluates `undefined === false` → `false`: the browser adapter
 * reports **permanently online** on device. Every offline gate in `chat-core`
 * reads through this port, so the failure is not a missing signal but an
 * actively wrong one — sends would be attempted against a dead network instead
 * of queueing to the outbox, and `flushOutbox` would run its retry loop while
 * offline. `network-state.spec.ts` pins the injection for that reason.
 *
 * The port is synchronous; `expo-network` is not. `isOffline()` therefore reads
 * a cached value kept current by the subscription, primed by `prime()` at boot.
 * Per the port's contract, unknown counts as **online** — the conservative
 * default, since a false "offline" would strand sends in the outbox.
 */

import {
  addNetworkStateListener,
  getNetworkStateAsync,
  type NetworkState as ExpoNetworkState,
} from "expo-network";
import type { NetworkState } from "@repo/chat-core/adapters";

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
