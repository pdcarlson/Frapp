/**
 * Teaches TanStack Query about connectivity and foregrounding.
 *
 * ## The gap this closes
 *
 * Nothing in this app wired `onlineManager` or `focusManager`, and
 * `lib/frapp-client.tsx` sets `refetchOnWindowFocus: false`. The consequence was
 * written down three separate times, each next to a control added to work
 * around it:
 *
 * - `components/state-block.tsx` — "`ErrorState` takes an explicit `onRetry`
 *   because … nothing wires `onlineManager`. Without a retry control a blip at
 *   launch leaves a screen dead until a force-quit."
 * - `app/(app)/(tabs)/index.tsx` and `app/(app)/(tabs)/events.tsx` — the same reasoning, in
 *   full, above their retry buttons.
 *
 * With both managers wired, `refetchOnReconnect` (a TanStack default) starts
 * firing and `spec/ui/resilience/caching.md`'s invalidation rows — "Network
 * reconnect → All queries" and "Window focus → All stale queries" — are
 * delivered rather than merely specified. A *server* error is a different
 * case, which no amount of connectivity signalling fixes: a list recovers from
 * one by a pull (#3385), and the explicit retry controls stay as the way out a
 * member can see.
 *
 * ## Why `focusManager` is driven by `AppState`, not window focus
 *
 * There is no window. `AppState`'s `"active"` is the mobile equivalent of a tab
 * regaining focus, and it is already how `use-is-api-authenticated.ts` refreshes
 * its token read.
 *
 * ## Focus returns when the network does, not when the app does (#3747)
 *
 * iOS tears down a suspended app's sockets. Bound straight to `AppState`, focus
 * came back the instant the app did, and that one edge fired every stale
 * query's focus refetch and resumed every retry the background had parked.
 * They all went out on the dead pooled connection and failed together within
 * ~500ms of the resume (NSURLError -1005; FRAPP-MOBILE-1…E, F, J). A query
 * gets one retry, so it had none left; a mark-read had none at all.
 *
 * So `background` drops focus as before, but focus comes back only once the
 * connection monitor's first foreground probe has its verdict
 * (`monitor.onResumeSettled`). TanStack's retryer will not continue while
 * unfocused, so a request that dies on the suspended socket in that window
 * parks its retry until `/health` has answered. Then focus returns, and the
 * focus refetch and the parked retries go out on a connection that works.
 * The wait is the probe, not a timer: a 5s timeout, plus one
 * `CONFIRM_RETRY_MS` retry when the first probe fails. A fresh request is not
 * held back by this, because focus gates only refetches and retries.
 *
 * Wiring is idempotent and reversible — `bindQueryConnectivity` returns its own
 * teardown so a spec can unwire between cases.
 */

import { AppState, type AppStateStatus } from "react-native";
import { focusManager, onlineManager } from "@tanstack/react-query";
import {
  connectionMonitor,
  type ConnectionMonitor,
  type MonitorDeps,
} from "./monitor";

export function bindQueryConnectivity(
  monitor: ConnectionMonitor = connectionMonitor,
  appState: MonitorDeps["appState"] = AppState,
): () => void {
  // DEGRADED is deliberately "online": requests are slow or intermittent, not
  // impossible, and telling TanStack the app is offline would pause every
  // retry exactly when a retry is what would recover it.
  const publish = () => onlineManager.setOnline(monitor.get() !== "OFFLINE");
  publish();
  const unsubscribeOnline = monitor.subscribe(publish);

  // `inactive` is iOS Control Center and the app switcher, not a background:
  // treating it as unfocused drops focus on every notification-shade pull,
  // which would stop a host's 10s attendance poll mid-check-in.
  // `app/(app)/study.tsx` draws the same line for its session heartbeat:
  // "Backgrounded means `background` — **not** 'anything but active'."
  const refocusIfSettled = (
    current: AppStateStatus | null | undefined = appState.currentState,
  ) => {
    if (current === "background") return;
    if (monitor.resumePending()) return;
    focusManager.setFocused(true);
  };
  const unsubscribeResume = monitor.onResumeSettled(() => refocusIfSettled());

  const subscription = appState.addEventListener(
    "change",
    (next: AppStateStatus) => {
      if (next === "background") {
        focusManager.setFocused(false);
        return;
      }
      // Usually still pending here, because the monitor has just started its
      // foreground probe (or hasn't seen this event yet, so it is still
      // suspended); then `onResumeSettled` refocuses. Not pending when the
      // monitor isn't running, or for `inactive` → `active`.
      refocusIfSettled(next);
    },
  );

  return () => {
    unsubscribeOnline();
    unsubscribeResume();
    subscription.remove();
  };
}
