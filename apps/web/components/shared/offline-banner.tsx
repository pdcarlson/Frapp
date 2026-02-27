"use client";

import { useNetwork } from "@/lib/providers/network-provider";
import { WifiOff, Zap } from "lucide-react";

export function OfflineBanner() {
  const { state, isOnline } = useNetwork();

  if (isOnline) return null;

  const config = {
    DEGRADED: {
      icon: Zap,
      message: "Slow connection. Some features may be delayed.",
      className: "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800",
    },
    OFFLINE: {
      icon: WifiOff,
      message: "You're offline. Showing cached data. Changes will sync when you reconnect.",
      className: "bg-red-50 text-red-800 border-red-200 dark:bg-red-950/50 dark:text-red-300 dark:border-red-800",
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
