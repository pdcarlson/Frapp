"use client";

import React, { createContext, useContext, useEffect, useState, useCallback } from "react";

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

const HEALTH_CHECK_URL = "/api/health";
const DEGRADED_THRESHOLD = 3;

export function NetworkProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ConnectionState>("ONLINE");
  const [failureCount, setFailureCount] = useState(0);

  const checkHealth = useCallback(async () => {
    if (!navigator.onLine) {
      setState("OFFLINE");
      return;
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const res = await fetch(HEALTH_CHECK_URL, {
        method: "HEAD",
        signal: controller.signal,
        cache: "no-store",
      });
      clearTimeout(timeout);

      if (res.ok) {
        setFailureCount(0);
        setState("ONLINE");
      } else {
        setFailureCount((prev) => prev + 1);
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
