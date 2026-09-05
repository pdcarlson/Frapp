"use client";

import { useNetwork } from "@/lib/providers/network-provider";
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
      // Worth knowing what this does NOT yet do: web still renders its write
      // controls enabled offline, so between #1707 and #1753 the member's only
      // signal is this banner plus the error toast their write produces. The
      // clause was removed because it was a false promise, not because the
      // gating that replaces it has landed — #1753 is that work, and § 2's
      // "disabled with 'Reconnect to make changes.'" arrives with it.
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
      className={`flex items-center gap-2 px-4 py-2 text-sm border-b animate-slide-down ${className}`}
      role="alert"
      aria-live="polite"
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}
