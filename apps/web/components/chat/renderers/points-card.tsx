"use client";

import { Coins } from "lucide-react";
import type { ChatMessage } from "@/lib/chat/types";
import type { PointsPayload } from "@repo/chat-integrations";

interface PointsCardProps {
  message: ChatMessage;
}

/**
 * Defensive read of a `points` payload. A malformed row (missing names, a
 * non-numeric amount) returns `null` so the renderer falls back to the
 * hot-path `content` string instead of blanking the timeline.
 */
function readPayload(message: ChatMessage): PointsPayload | null {
  const raw = message.payload;
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const { amount } = r;
  if (
    typeof r.actor_name !== "string" ||
    typeof r.recipient_name !== "string" ||
    typeof r.reason !== "string" ||
    typeof amount !== "number" ||
    !Number.isFinite(amount)
  ) {
    return null;
  }
  return {
    actor_user_id: typeof r.actor_user_id === "string" ? r.actor_user_id : "",
    actor_name: r.actor_name,
    recipient_user_id:
      typeof r.recipient_user_id === "string" ? r.recipient_user_id : "",
    recipient_name: r.recipient_name,
    amount,
    category: r.category === "FINE" ? "FINE" : "MANUAL",
    reason: r.reason,
    transaction_id:
      typeof r.transaction_id === "string" ? r.transaction_id : "",
    created_at: typeof r.created_at === "string" ? r.created_at : "",
  };
}

/**
 * Points card: a read-only, append-only record of a single ledger adjustment
 * (`actor → recipient`, signed amount, reason). Server-originated — there are no
 * action buttons and the card is never edited (corrections are new entries).
 */
export function PointsCard({ message }: PointsCardProps) {
  const payload = readPayload(message);
  if (!payload) {
    return (
      <div className="mt-1 whitespace-pre-wrap break-words text-sm">
        {message.content}
      </div>
    );
  }

  const isFine = payload.amount < 0 || payload.category === "FINE";
  const magnitude = Math.abs(payload.amount);

  return (
    <div className="mt-1 rounded-md border-l-4 border-[color:var(--side-accent,#7A5A2F)] bg-[color:var(--mention-bg,theme(colors.amber.50))] px-3 py-2">
      <div className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-[color:var(--side-accent,#7A5A2F)]">
        <Coins className="h-3 w-3" aria-hidden="true" /> Points
      </div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
        <span className="font-medium">{payload.actor_name}</span>
        <span className="text-muted-foreground">
          {isFine ? "deducted" : "granted"}
        </span>
        <span
          className={
            isFine
              ? "font-semibold text-red-600 dark:text-red-400"
              : "font-semibold text-emerald-700 dark:text-emerald-400"
          }
        >
          {isFine ? "−" : "+"}
          {magnitude} {magnitude === 1 ? "point" : "points"}
        </span>
        <span className="text-muted-foreground">{isFine ? "from" : "to"}</span>
        <span className="font-medium">{payload.recipient_name}</span>
      </div>
      <div className="mt-1 whitespace-pre-wrap break-words text-sm text-muted-foreground">
        &ldquo;{payload.reason}&rdquo;
      </div>
    </div>
  );
}
