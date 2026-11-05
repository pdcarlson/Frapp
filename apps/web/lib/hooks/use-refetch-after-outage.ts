"use client";

import { useEffect, useRef } from "react";

/**
 * Re-runs a gate's read once after an outage, if the outage left it failed
 * with nothing cached. `Can` (permissions) and the module gate both use it.
 *
 * A paused read resumes by itself when TanStack sees the connection return.
 * One that failed while the dashboard was OFFLINE does not: TanStack's
 * `onlineManager` only moves on the window's `offline` event, so it never saw
 * an outage to recover from (#2267). Without this, the member's reconnect
 * would land on a failed check that nobody re-ran.
 *
 * The flag survives the reconnect itself. A read still in its backoff when
 * `useNetwork()` leaves OFFLINE can spend its last attempt after the
 * connection is back and fail then, so the re-run waits for that failure
 * rather than looking only at the moment of reconnect. It runs at most once
 * per outage, and an answer, or switching the read off, clears it.
 *
 * `cancelRefetch: false` because every gate on the page runs this effect for
 * the same query, and the default would have each call abort the one before.
 */
export function useRefetchAfterOutage(read: {
  isOffline: boolean;
  enabled: boolean;
  isError: boolean;
  loaded: boolean;
  refetch: (options: { cancelRefetch: boolean }) => unknown;
}): void {
  const { isOffline, enabled, isError, loaded, refetch } = read;
  const sawOutage = useRef(false);
  useEffect(() => {
    if (isOffline) {
      sawOutage.current = true;
      return;
    }
    if (!sawOutage.current) return;
    if (loaded || !enabled) {
      sawOutage.current = false;
      return;
    }
    if (isError) {
      sawOutage.current = false;
      void refetch({ cancelRefetch: false });
    }
  }, [isOffline, enabled, isError, loaded, refetch]);
}
