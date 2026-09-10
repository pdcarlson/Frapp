"use client";

import { ServiceGlyph } from "../chat-glyphs";
import { EYEBROW, MESSAGE_CARD } from "../chip";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatMinutesExact } from "@repo/formatting";
import type { ChatMessage } from "@repo/chat-core/types";
import type { HoursPayload } from "@repo/chat-integrations";

interface HoursCardProps {
  message: ChatMessage;
}

/**
 * Defensive read of an `hours` payload. A malformed row (missing names, a
 * non-numeric duration) returns `null` so the renderer falls back to the
 * hot-path `content` string instead of blanking the timeline.
 */
function readPayload(message: ChatMessage): HoursPayload | null {
  const raw = message.payload;
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const { duration_minutes } = r;
  if (
    typeof r.entry_id !== "string" ||
    typeof r.user_id !== "string" ||
    typeof r.user_name !== "string" ||
    typeof r.description !== "string" ||
    typeof r.date !== "string" ||
    r.status !== "PENDING" ||
    typeof duration_minutes !== "number" ||
    !Number.isFinite(duration_minutes)
  ) {
    return null;
  }
  return {
    entry_id: r.entry_id,
    user_id: r.user_id,
    user_name: r.user_name,
    duration_minutes,
    description: r.description,
    date: r.date,
    status: "PENDING",
    created_at: typeof r.created_at === "string" ? r.created_at : "",
  };
}

/**
 * Hours card: a read-only, append-only record of a single service-entry log
 * (`member logged N of service on DATE`). Server-originated — there are no
 * action buttons and the card is never edited (review happens on the service
 * hours page). The snapshot is creation-time `PENDING`; live status is a later
 * concern.
 */
export function HoursCard({ message }: HoursCardProps) {
  const payload = readPayload(message);
  if (!payload) {
    return (
      <div className="mt-1 whitespace-pre-wrap break-words text-base">
        {message.content}
      </div>
    );
  }

  return (
    <Card className={cn(MESSAGE_CARD)}>
      <div className="flex items-center justify-between gap-2">
        <div
          className={cn(EYEBROW, "flex items-center gap-1.5 text-accent-text")}
        >
          <ServiceGlyph className="h-4 w-4" /> Service hours
        </div>
        <Badge variant="warning">Pending review</Badge>
      </div>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-base">
        <span className="font-semibold">{payload.user_name}</span>
        <span className="text-muted-foreground">logged</span>
        <span className="font-semibold">
          {formatMinutesExact(payload.duration_minutes)}
        </span>
        <span className="text-muted-foreground">on</span>
        <span className="font-semibold">{payload.date}</span>
      </div>
      <div className="mt-2 whitespace-pre-wrap break-words text-base text-muted-foreground">
        &ldquo;{payload.description}&rdquo;
      </div>
    </Card>
  );
}
