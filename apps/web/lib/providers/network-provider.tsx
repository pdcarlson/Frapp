"use client";

import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
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

export function NetworkProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ConnectionState>("ONLINE");
  const [failureCount, setFailureCount] = useState(0);

  const checkHealth = useCallback(async () => {
    if (!navigator.onLine) {
      setState("OFFLINE");
      return;
    }

    const healthCheckUrl = getHealthCheckUrl();
    if (!healthCheckUrl) {
      setFailureCount(0);
      setState("ONLINE");
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
          setState("ONLINE");
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
    if (failureCount >= DEGRADED_THRESHOLD) {
      setState("DEGRADED");
    }
  }, [failureCount]);

  useEffect(() => {
    const interval = setInterval(checkHealth, 30_000);
    return () => clearInterval(interval);
  }, [checkHealth]);

  useEffect(() => {
    const handleOnline = () => {
      setState("ONLINE");
      setFailureCount(0);
    };
    const handleOffline = () => setState("OFFLINE");

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    if (!navigator.onLine) {
      setState("OFFLINE");
    }

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

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
