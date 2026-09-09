"use client";

import { useLayoutEffect, useRef } from "react";
import { useNetwork } from "@/lib/providers/network-provider";
import { FOCUS_RING_ALWAYS } from "@/components/ui/focus";
import {
  OFFLINE_BANNER_HEIGHT_VAR,
  OFFLINE_BANNER_ID,
} from "@/components/shared/offline-banner-focus";
import { WifiOff, Zap } from "lucide-react";

export {
  OFFLINE_BANNER_HEIGHT_VAR,
  OFFLINE_BANNER_ID,
  focusOfflineBanner,
} from "@/components/shared/offline-banner-focus";

export function OfflineBanner() {
  const { state, isOnline } = useNetwork();
  const bannerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const root = document.documentElement;
    if (isOnline) {
      root.style.removeProperty(OFFLINE_BANNER_HEIGHT_VAR);
      return;
    }
    const node = bannerRef.current;
    if (!node) return;

    const publishHeight = () => {
      root.style.setProperty(
        OFFLINE_BANNER_HEIGHT_VAR,
        `${node.getBoundingClientRect().height}px`,
      );
    };
    publishHeight();
    const observer = new ResizeObserver(publishHeight);
    observer.observe(node);
    return () => {
      observer.disconnect();
      root.style.removeProperty(OFFLINE_BANNER_HEIGHT_VAR);
    };
  }, [isOnline]);

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
      className: "border-destructive/45 bg-destructive/[.13] text-destructive",
    },
  } as const;

  const { icon: Icon, message, className } = config[state as "DEGRADED" | "OFFLINE"];

  return (
    <div
      ref={bannerRef}
      id={OFFLINE_BANNER_ID}
      tabIndex={-1}
      className={`sticky top-0 z-40 flex items-center gap-2 px-4 py-2 text-sm border-b animate-slide-down ${className} ${FOCUS_RING_ALWAYS}`}
      role="alert"
      aria-live="polite"
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}
