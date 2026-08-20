"use client";

import { CloudOff, Loader2, RefreshCw } from "lucide-react";
import type { ConnectionStatus } from "@repo/chat-core/realtime-manager";

/**
 * Small status indicator rendered near the channel header. Stays out of the
 * way when the connection is live; surfaces clearly when the realtime stream
 * is reconnecting, has degraded to polling, or the user is offline.
 *
 * The polling copy is fixed by `spec/ui/resilience.md` §3.2 — keep it verbatim.
 */
export function ReconnectPill({ status }: { status: ConnectionStatus }) {
  if (status === "live") return null;

  const tone =
    status === "offline"
      ? "border-destructive/40 bg-destructive/10 text-destructive"
      : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300";

  return (
    <div
      className={`flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] ${tone}`}
      role="status"
      aria-live="polite"
    >
      {status === "offline" ? (
        <>
          <CloudOff className="h-3 w-3" aria-hidden="true" /> Offline — messages will send when you reconnect
        </>
      ) : status === "polling" ? (
        <>
          <RefreshCw className="h-3 w-3 animate-spin" aria-hidden="true" /> Real-time updates paused. Polling for new messages.
        </>
      ) : (
        <>
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> Reconnecting…
        </>
      )}
    </div>
  );
}
