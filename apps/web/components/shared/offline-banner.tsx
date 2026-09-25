"use client";

import { useNetwork } from "@/lib/providers/network-provider";
import { FOCUS_RING_ALWAYS } from "@/components/ui/focus";
import { OFFLINE_BANNER_ID } from "@/components/shared/offline-banner-focus";
import { WifiOff, Zap } from "lucide-react";

export function OfflineBanner() {
  const { state, isOnline } = useNetwork();

  if (isOnline) return null;

  // The Signet semantic tint recipe (foundations.md §5): ~13% of the hue as
  // fill with the hue as text. Degraded is warning, offline is destructive —
  // both state a fact about the connection, which is what semantic colour is
  // for. This banner is rendered by the root layout, so it sits on the dark
  // surface on every route including pre-auth.
  const config = {
    DEGRADED: {
      icon: Zap,
      message: "Slow connection. Some features may be delayed.",
      className: "border-warning/45 bg-warning/[.13] text-warning",
    },
    OFFLINE: {
      icon: WifiOff,
      // "Changes will sync when you reconnect." was dropped in #1707, because
      // that promise is false everywhere this banner renders. It was only ever
      // true for the chat composer, which has a real outbox — and the composer
      // says so itself, at the control ("You're offline — messages send when
      // you reconnect.", `composer.tsx`), per § 2's "labeled, never blocked,
      // wherever an outbox exists". Every other dashboard write is queueless:
      // it used to *pause* offline, which looked like a sync that never came,
      // and now rejects. § 1 principle 1 — "actions must never appear to
      // succeed when they haven't" — makes the honest string the shorter one.
      //
      // Queueless writes now disable in `useSubscriptionGate` (#1753) with
      // `title="Reconnect to make changes."` on the control. This banner is
      // still the one page-level announcement — the per-control title must
      // not grow a second live region, which is why `SubscriptionNotice`
      // stays silent on an offline-only block.
      //
      // What remains is § 2's OFFLINE banner cell verbatim, which is also what
      // mobile ships (`apps/mobile/lib/connection/state.ts`).
      message: "You're offline. Showing cached data.",
      /*
       * Stays on the SOLID `--destructive`, not the `--destructive-text` lift.
       * The banner is seated on `--background` (the pill paints an opaque
       * `bg-background` under the tint), and danger on its own 13% tint over that step
       * measures 4.850:1 — clear of the gate. The lift is for where the drawn
       * tone actually misses, which on this ladder is `--surface-1` (4.472),
       * `--card` (4.222) and `--popover` (3.817). Applying it here would
       * over-apply foundations §5, the same over-reach the billing guard's
       * "negative branch" case records.
       */
      className: "border-destructive/45 bg-destructive/[.13] text-destructive",
    },
  } as const;

  const {
    icon: Icon,
    message,
    className,
  } = config[state as "DEGRADED" | "OFFLINE"];

  /*
   * An overlay, never a row in the page (#2244). This banner used to be a
   * `sticky` block in flow above the dashboard shell, so every state change
   * after paint (and DEGRADED flaps on a single failed `/health` probe) moved
   * the nav, the top bar and every page title down by its height and back up
   * again on recovery. No reservation made before paint can fix that, because
   * the state arrives later, so the banner takes no layout space at all.
   *
   * It floats as a centred pill: below the 48px top bar while the dashboard
   * shell is mounted, which is `connection-state.md`'s "top of the content
   * area (below header bar)", and at the top of the viewport on the pre-auth
   * routes, which have no bar. The shell marks itself with
   * `data-dashboard-shell` (`DASHBOARD_SHELL_ATTR`) rather than this component
   * asking the router,
   * because a CSS `:has()` rule is settled before first paint and a pathname
   * check is one more list of routes to keep in step.
   *
   * The full-width wrapper is `pointer-events-none` so the strip beside the
   * pill never eats a click meant for the page under it. `z-40` keeps it above
   * content and under dialogs and sheets (`z-50`), which dim it like everything
   * else behind them.
   */
  return (
    <div className="pointer-events-none fixed inset-x-0 top-2 z-40 flex justify-center px-4 [html:has([data-dashboard-shell])_&]:top-14">
      <div
        id={OFFLINE_BANNER_ID}
        tabIndex={-1}
        className={`pointer-events-auto max-w-full rounded-lg bg-background shadow-md animate-slide-down ${FOCUS_RING_ALWAYS}`}
        role="alert"
        aria-live="polite"
      >
        <div
          className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm ${className}`}
        >
          <Icon className="h-4 w-4 shrink-0" />
          <span>{message}</span>
        </div>
      </div>
    </div>
  );
}
