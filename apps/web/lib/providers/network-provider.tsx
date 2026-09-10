"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  useSyncExternalStore,
} from "react";
import { normalizeApiBaseUrl, withRequestIdInit } from "@repo/api-sdk";
import {
  deriveConnectionState,
  healthProbeIsReachable,
  type ConnectionState,
} from "@repo/validation";

export type { ConnectionState };

interface NetworkContextValue {
  state: ConnectionState;
  isOnline: boolean;
  isDegraded: boolean;
  isOffline: boolean;
  /**
   * Browser link only — not API reachability. Presence rides the Supabase
   * Realtime socket, a different service from `/health`, so it gates on this
   * rather than `isOffline`.
   */
  linkOnline: boolean;
  /** One `/health` probe. OfflineState Retry and tests call this. */
  probeOnce: () => Promise<void>;
}

const NetworkContext = createContext<NetworkContextValue>({
  state: "ONLINE",
  isOnline: true,
  isDegraded: false,
  isOffline: false,
  linkOnline: true,
  probeOnce: async () => {},
});

/*
 * `/health` is the one route that is not under `/v1`, so the poll needs the
 * bare origin. That is the same normalization the SDK applies to its own
 * baseUrl, so it comes from the shared helper rather than a second local copy
 * of the rule — the two drifting apart is what let a doubled `/v1` 404 every
 * data request while this health poll kept reporting ONLINE.
 */
function getHealthCheckUrl() {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  if (!apiUrl) {
    return null;
  }
  return `${normalizeApiBaseUrl(apiUrl)}/health`;
}

function subscribeLinkOnline(onStoreChange: () => void): () => void {
  window.addEventListener("online", onStoreChange);
  window.addEventListener("offline", onStoreChange);
  return () => {
    window.removeEventListener("online", onStoreChange);
    window.removeEventListener("offline", onStoreChange);
  };
}

function getLinkOnline(): boolean {
  return navigator.onLine;
}

function getLinkOnlineServer(): boolean {
  return true;
}

export function NetworkProvider({ children }: { children: React.ReactNode }) {
  const linkOnline = useSyncExternalStore(
    subscribeLinkOnline,
    getLinkOnline,
    getLinkOnlineServer,
  );
  const [failureCount, setFailureCount] = useState(0);
  const probeGenerationRef = useRef(0);

  const probeOnce = useCallback(async () => {
    if (!navigator.onLine) {
      return;
    }

    const healthCheckUrl = getHealthCheckUrl();
    if (!healthCheckUrl) {
      setFailureCount(0);
      return;
    }

    const generation = ++probeGenerationRef.current;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      try {
        const res = await fetch(
          healthCheckUrl,
          withRequestIdInit({
            method: "GET",
            signal: controller.signal,
            cache: "no-store",
          }),
        );

        if (generation !== probeGenerationRef.current) {
          return;
        }

        if (healthProbeIsReachable(res)) {
          setFailureCount(0);
        } else {
          setFailureCount((prev) => prev + 1);
        }
      } finally {
        clearTimeout(timeout);
      }
    } catch {
      if (generation !== probeGenerationRef.current) {
        return;
      }
      setFailureCount((prev) => prev + 1);
    }
  }, []);

  useEffect(() => {
    // Probe on mount, not only on the first interval tick. Without this a
    // cold start against a dead API reports ONLINE for a full poll period
    // before the first failure even lands — and OFFLINE needs three.
    //
    // Schedule the first probe on a microtask, not in the effect body:
    // `probeOnce` can `setFailureCount` synchronously when no API URL is
    // configured, which `react-hooks/set-state-in-effect` forbids. The
    // cancelled flag also drops the StrictMode double-invoke so a single
    // failed fetch cannot count as two.
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) void probeOnce();
    });
    const interval = setInterval(() => void probeOnce(), 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [probeOnce]);

  useEffect(() => {
    // Do not blindly reset the counter on `online`: if `/health` is still
    // dead, that would flash ONLINE and then take 90s to reach OFFLINE
    // again. Probe; a reachable response is what clears the count.
    const handleOnline = () => void probeOnce();
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [probeOnce]);

  const state = deriveConnectionState({
    linkOffline: !linkOnline,
    consecutiveFailures: failureCount,
  });

  const value: NetworkContextValue = {
    state,
    isOnline: state === "ONLINE",
    isDegraded: state === "DEGRADED",
    isOffline: state === "OFFLINE",
    linkOnline,
    probeOnce,
  };

  return (
    <NetworkContext.Provider value={value}>{children}</NetworkContext.Provider>
  );
}

export function useNetwork() {
  return useContext(NetworkContext);
}
