"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useSyncExternalStore,
} from "react";
import { normalizeApiBaseUrl } from "@repo/api-sdk";

export type ConnectionState = "ONLINE" | "DEGRADED" | "OFFLINE";

interface NetworkContextValue {
  state: ConnectionState;
  isOnline: boolean;
  isDegraded: boolean;
  isOffline: boolean;
}

const NetworkContext = createContext<NetworkContextValue>({
  state: "ONLINE",
  isOnline: true,
  isDegraded: false,
  isOffline: false,
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

const DEGRADED_THRESHOLD = 3;

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

  const checkHealth = useCallback(async () => {
    if (!navigator.onLine) {
      return;
    }

    const healthCheckUrl = getHealthCheckUrl();
    if (!healthCheckUrl) {
      setFailureCount(0);
      return;
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      try {
        const res = await fetch(healthCheckUrl, {
          method: "GET",
          signal: controller.signal,
          cache: "no-store",
        });

        if (res.ok) {
          setFailureCount(0);
        } else {
          setFailureCount((prev) => prev + 1);
        }
      } finally {
        clearTimeout(timeout);
      }
    } catch {
      setFailureCount((prev) => prev + 1);
    }
  }, []);

  useEffect(() => {
    const interval = setInterval(checkHealth, 30_000);
    return () => clearInterval(interval);
  }, [checkHealth]);

  useEffect(() => {
    const handleOnline = () => setFailureCount(0);
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, []);

  const state: ConnectionState = !linkOnline
    ? "OFFLINE"
    : failureCount >= DEGRADED_THRESHOLD
      ? "DEGRADED"
      : "ONLINE";

  const value: NetworkContextValue = {
    state,
    isOnline: state === "ONLINE",
    isDegraded: state === "DEGRADED",
    isOffline: state === "OFFLINE",
  };

  return (
    <NetworkContext.Provider value={value}>{children}</NetworkContext.Provider>
  );
}

export function useNetwork() {
  return useContext(NetworkContext);
}
