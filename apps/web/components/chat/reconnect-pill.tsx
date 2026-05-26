"use client";

import { CloudOff, Loader2, Wifi } from "lucide-react";
import type { ConnectionStatus } from "@/lib/chat/realtime-manager";

/**
 * Small status indicator rendered near the channel header. Stays out of the
 * way when the connection is live; surfaces clearly when the realtime stream
 * is reconnecting or the user is offline.
 */
export function ReconnectPill({ status }: { status: ConnectionStatus }) {
  if (status === "live") return null;
  const isOffline = status === "offline";
  return (
    <div
      className={`flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] ${
        isOffline
          ? "border-destructive/40 bg-destructive/10 text-destructive"
          : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
      }`}
      role="status"
      aria-live="polite"
    >
      {isOffline ? (
        <>
          <CloudOff className="h-3 w-3" /> Offline — messages will send when you reconnect
        </>
      ) : (
        <>
          <Loader2 className="h-3 w-3 animate-spin" /> Reconnecting…
        </>
      )}
      <span className="sr-only">
        <Wifi />
      </span>
    </div>
  );
}
