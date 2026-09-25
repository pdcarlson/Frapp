"use client";

import { useEffect, useState } from "react";
import { useNetwork } from "@/lib/providers/network-provider";
import { FOCUS_RING, FOCUS_RING_ALWAYS } from "@/components/ui/focus";
import { OFFLINE_BANNER_ID } from "@/components/shared/offline-banner-focus";
import { WifiOff, X, Zap } from "lucide-react";

/**
 * `connection-state.md` § Banner behavior: a dismissed banner comes back if
 * the state hasn't changed after 30s.
 */
export const BANNER_REDISPLAY_MS = 30_000;

export function OfflineBanner() {
  const { state, isOnline } = useNetwork();

  /*
   * Dismissal is per state, not sticky. A change of state (DEGRADED to
   * OFFLINE, or a recovery and a relapse) shows the banner again at once,
   * which is the render-time reset React documents for "adjusting state when
   * a prop changes" rather than an effect that would paint the stale value
   * first. An unchanged state shows it again after `BANNER_REDISPLAY_MS`.
   */
  const [dismissed, setDismissed] = useState(false);
  const [seenState, setSeenState] = useState(state);
  if (state !== seenState) {
    setSeenState(state);
    setDismissed(false);
  }
  useEffect(() => {
    if (!dismissed) return;
    const timer = setTimeout(() => setDismissed(false), BANNER_REDISPLAY_MS);
    return () => clearTimeout(timer);
  }, [dismissed]);

  if (isOnline || dismissed) return null;

  // The Signet semantic tint recipe (foundations.md §5): ~13% of the hue as
  // fill with the hue as text. Degraded is warning, offline is destructive —
  // both state a fact about the connection, which is what semantic colour is
  // for. This banner is rendered by the root layout, so it sits on the dark
  // surface on every route including pre-auth.
  const config = {
    DEGRADED: {
      icon: Zap,
      message: "Slow connection. Some features may be delayed.",
      className: "border-warning/45 bg-warning-tint text-warning",
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
       * The `--destructive-text` lift, since #2376. Until then this stayed on
       * solid `--destructive`, because an alpha tint over the `--background`
       * the pill is seated on measured 4.850:1. The tint is an opaque token
       * now, one colour whatever it sits on, and solid danger on it measures
       * 4.222:1 on every surface: under the gate. The lift measures 5.612:1.
       */
      className:
        "border-destructive/45 bg-destructive-tint text-destructive-text",
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
   * asking the router, because a CSS `:has()` rule is settled before first
   * paint and a pathname check is one more list of routes to keep in step.
   * `top-14` is the bar's `h-12` plus an 8px gap; the shell spec pins the bar
   * height it depends on.
   *
   * Floating means it sits over the first row of the content area, which on a
   * phone is a page's title and actions or chat's Back and channel-menu
   * buttons. So nothing but the dismiss control takes a pointer: a tap on the
   * pill lands on whatever is under it, and dismissing uncovers it for as
   * long as the state holds. `z-40` keeps it above content and under dialogs
   * and sheets (`z-50`), which dim it like everything else behind them.
   */
  return (
    <div className="pointer-events-none fixed inset-x-0 top-2 z-40 flex justify-center px-4 [html:has([data-dashboard-shell])_&]:top-14">
      <div
        id={OFFLINE_BANNER_ID}
        tabIndex={-1}
        className={`max-w-full rounded-lg bg-background shadow-md animate-slide-down ${FOCUS_RING_ALWAYS}`}
        role="alert"
        aria-live="polite"
      >
        <div
          className={`flex items-center gap-2 rounded-lg border py-1.5 pl-3 pr-1.5 text-sm ${className}`}
        >
          <Icon className="h-4 w-4 shrink-0" />
          <span>{message}</span>
          {/*
            24px drawn, 44px to a coarse pointer (the touch floor), with the
            negative margin absorbing the difference so the pill stays one
            text line tall on a phone.
          */}
          <button
            type="button"
            onClick={() => setDismissed(true)}
            aria-label="Dismiss the connection notice"
            className={`pointer-events-auto grid h-6 w-6 shrink-0 place-items-center rounded-md hover:bg-foreground/10 pointer-coarse:-m-2.5 pointer-coarse:h-11 pointer-coarse:w-11 ${FOCUS_RING}`}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
