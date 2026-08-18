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
 * - `app/(tabs)/index.tsx` and `app/(tabs)/events.tsx` — the same reasoning, in
 *   full, above their retry buttons.
 *
 * With both managers wired, `refetchOnReconnect` (a TanStack default) starts
 * firing and `spec/ui/resilience.md` § 8's invalidation rows — "Network
 * reconnect → All queries" and "Window focus → All stale queries" — are
 * delivered rather than merely specified. The explicit retry controls stay:
 * they are still the only recovery for a *server* error, which no amount of
 * connectivity signalling fixes. Their comments have been corrected so they no
 * longer assert something untrue.
 *
 * ## Why `focusManager` is driven by `AppState`, not window focus
 *
 * There is no window. `AppState`'s `"active"` is the mobile equivalent of a tab
 * regaining focus, and it is already how `use-is-api-authenticated.ts` refreshes
 * its token read.
 *
 * Wiring is idempotent and reversible — `bindQueryConnectivity` returns its own
 * teardown so a spec can unwire between cases.
 */

import { AppState, type AppStateStatus } from "react-native";
import { focusManager, onlineManager } from "@tanstack/react-query";
import { connectionMonitor, type ConnectionMonitor } from "./monitor";

export function bindQueryConnectivity(
  monitor: ConnectionMonitor = connectionMonitor,
): () => void {
  // DEGRADED is deliberately "online": requests are slow or intermittent, not
  // impossible, and telling TanStack the app is offline would pause every
  // retry exactly when a retry is what would recover it.
  const publish = () => onlineManager.setOnline(monitor.get() !== "OFFLINE");
  publish();
  const unsubscribeOnline = monitor.subscribe(publish);

  const subscription = AppState.addEventListener(
    "change",
    (next: AppStateStatus) => {
      // `inactive` is iOS Control Center and the app switcher, not a
      // background — treating it as unfocused drops focus on every
      // notification-shade pull, which would stop a host's 10s attendance poll
      // mid-check-in. `app/(tabs)/study.tsx` draws the same line for its
      // session heartbeat: "Backgrounded means `background` — **not** 'anything
      // but active'."
      focusManager.setFocused(next !== "background");
    },
  );

  return () => {
    unsubscribeOnline();
    subscription.remove();
  };
}
