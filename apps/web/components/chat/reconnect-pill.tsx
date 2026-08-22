"use client";

import { Loader2, RefreshCw } from "lucide-react";
import { OfflineGlyph } from "./chat-glyphs";
import type { ConnectionStatus } from "@repo/chat-core/realtime-manager";

/**
 * Small status indicator rendered near the channel header. Stays out of the
 * way when the connection is live; surfaces clearly when the realtime stream
 * is reconnecting, has degraded to polling, or the user is offline.
 *
 * **Tones are semantic tokens, not palette.** This used to paint
 * `border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300` —
 * raw Tailwind amber with an inert `dark:` twin (nothing sets `.dark`; Signet is
 * dark-only), so the light branch was what shipped. The recipe now matches the
 * global connection banner (`components/shared/offline-banner.tsx`) and
 * foundations.md §5: a ~13% tint of the hue as fill with the hue as text,
 * `--warning` for degraded and `--destructive` for offline.
 *
 * The danger text is the AA-lifted `--destructive-text`, not `--destructive`:
 * `#F85149` on its own 13% tint measures 4.39:1 over `--card`, under the 4.5:1
 * floor README §6 sets — the same lift the primitives slice made for badges and
 * toasts (components.md §1).
 *
 * The three copy strings are fixed by `spec/ui/resilience.md` §3.2 — keep them
 * verbatim.
 */
export function ReconnectPill({ status }: { status: ConnectionStatus }) {
  if (status === "live") return null;

  const tone =
    status === "offline"
      ? "border-destructive/45 bg-destructive/[.13] text-destructive-text"
      : "border-warning/45 bg-warning/[.13] text-warning";

  return (
    <div
      className={`flex items-center gap-1.5 rounded-xs border px-2.5 py-1 text-[12.5px] font-semibold ${tone}`}
      role="status"
      aria-live="polite"
    >
      {status === "offline" ? (
        <>
          <OfflineGlyph className="h-3.5 w-3.5 shrink-0" /> Offline — messages will send when you reconnect
        </>
      ) : status === "polling" ? (
        <>
          <RefreshCw className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" /> Real-time updates paused. Polling for new messages.
        </>
      ) : (
        <>
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" /> Reconnecting…
        </>
      )}
    </div>
  );
}
