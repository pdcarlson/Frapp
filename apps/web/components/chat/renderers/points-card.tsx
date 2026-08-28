"use client";

import { PointsGlyph } from "../chat-glyphs";
import { EYEBROW, MESSAGE_CARD } from "../chip";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@repo/chat-core/types";
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
      <div className="mt-1 whitespace-pre-wrap break-words text-base">
        {message.content}
      </div>
    );
  }

  const isFine = payload.amount < 0 || payload.category === "FINE";
  const magnitude = Math.abs(payload.amount);

  return (
    <Card className={cn(MESSAGE_CARD)}>
      <div className={cn(EYEBROW, "flex items-center gap-1.5 text-accent-text")}>
        <PointsGlyph className="h-4 w-4" /> Points
      </div>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-base">
        <span className="font-semibold">{payload.actor_name}</span>
        <span className="text-muted-foreground">
          {isFine ? "deducted" : "granted"}
        </span>
        {/*
          Semantic tokens, not palette. These were `text-red-600` /
          `text-emerald-700` with `dark:` twins that could never fire — nothing
          sets `.dark`, Signet being dark-only — so the *light* branch was what
          shipped onto `#0E0D0B`. Danger takes the AA-lifted `--destructive-text`
          (components.md §1); a grant is `--success`.
        */}
        <span
          className={
            isFine
              ? "font-semibold text-destructive-text"
              : "font-semibold text-success"
          }
        >
          {isFine ? "−" : "+"}
          {magnitude} {magnitude === 1 ? "point" : "points"}
        </span>
        <span className="text-muted-foreground">{isFine ? "from" : "to"}</span>
        <span className="font-semibold">{payload.recipient_name}</span>
      </div>
      <div className="mt-2 whitespace-pre-wrap break-words text-base text-muted-foreground">
        &ldquo;{payload.reason}&rdquo;
      </div>
    </Card>
  );
}
