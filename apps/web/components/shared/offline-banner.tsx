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
      message: "You're offline. Showing cached data. Changes will sync when you reconnect.",
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
