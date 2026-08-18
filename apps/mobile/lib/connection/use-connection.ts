/**
 * Reading the connection state from a component.
 *
 * `useConnection()` is the read; `useConnectionRuntime()` is the once-per-app
 * start, called by `components/app-runtime.tsx`. Split because almost every
 * caller wants the former, and starting a poll from each of them would be a
 * bug.
 */

import { useEffect, useSyncExternalStore } from "react";
import { connectionMonitor } from "./monitor";
import { bindQueryConnectivity } from "./query-connectivity";
import {
  connectionBannerCopy,
  writeBlockedReason,
  type ConnectionState,
} from "./state";

export interface Connection {
  state: ConnectionState;
  isOffline: boolean;
  isDegraded: boolean;
  /** Banner copy, or `null` when there is nothing to say. */
  message: string | null;
  /**
   * Why a *queueless* write is disabled, or `null`.
   *
   * Read this only on surfaces that lose a failed write. The chat composer must
   * not: `sendMessage` enqueues to the outbox and returns before touching the
   * network, so gating it would defeat the queue built to make
   * composing-while-offline work. `spec/ui/resilience.md` records the split.
   */
  writeBlockedReason: string | null;
}

export function useConnection(): Connection {
  const state = useSyncExternalStore(
    (onChange) => connectionMonitor.subscribe(onChange),
    () => connectionMonitor.get(),
    () => connectionMonitor.get(),
  );

  return {
    state,
    isOffline: state === "OFFLINE",
    isDegraded: state === "DEGRADED",
    message: connectionBannerCopy(state),
    writeBlockedReason: writeBlockedReason(state),
  };
}

/**
 * Starts the monitor and binds TanStack to it. Mount exactly once.
 *
 * No local state: `useConnection` subscribes through `useSyncExternalStore`, so
 * a state that resolves after this effect runs reaches every reader on its own.
 */
export function useConnectionRuntime(): void {
  useEffect(() => {
    connectionMonitor.start();
    const unbind = bindQueryConnectivity();
    return () => {
      unbind();
      connectionMonitor.stop();
    };
  }, []);
}
