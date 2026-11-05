"use client";

import { PointsGlyph } from "../chat-glyphs";
import { EYEBROW, MESSAGE_CARD } from "../chip";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@repo/chat-core/types";
import { pointsChange, readPointsPayload } from "@repo/chat-core/cards";

interface PointsCardProps {
  message: ChatMessage;
}

/**
 * Points card: a read-only, append-only record of a single ledger adjustment
 * (`actor → recipient`, signed amount, reason). Server-originated — there are no
 * action buttons and the card is never edited (corrections are new entries).
 *
 * The payload reader and the sentence's words (`readPointsPayload`,
 * `pointsChange`) are `@repo/chat-core/cards`, which mobile's card reads too.
 * A malformed row falls back to the hot-path `content` string.
 */
export function PointsCard({ message }: PointsCardProps) {
  const payload = readPointsPayload(message);
  if (!payload) {
    return (
      <div className="mt-1 whitespace-pre-wrap break-words text-base">
        {message.content}
      </div>
    );
  }

  const change = pointsChange(payload);

  return (
    <Card className={cn(MESSAGE_CARD)}>
      <div className={cn(EYEBROW, "flex items-center gap-1.5 text-accent-text")}>
        <PointsGlyph className="h-4 w-4" /> Points
      </div>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-base">
        <span className="font-semibold">{payload.actor_name}</span>
        <span className="text-muted-foreground">{change.verb}</span>
        {/*
          Semantic tokens, not palette. These were `text-red-600` /
          `text-emerald-700` with `dark:` twins that could never fire — nothing
          sets `.dark`, the design system being dark-only — so the *light* branch was what
          shipped onto `#0E0D0B`. Danger takes the AA-lifted `--destructive-text`
          (components.md §1); a grant is `--success`.
        */}
        <span
          className={
            change.fine
              ? "font-semibold text-destructive-text"
              : "font-semibold text-success"
          }
        >
          {change.amount}
        </span>
        <span className="text-muted-foreground">{change.preposition}</span>
        <span className="font-semibold">{payload.recipient_name}</span>
      </div>
      {payload.reason.trim() ? (
        <div className="mt-2 whitespace-pre-wrap break-words text-base text-muted-foreground">
          &ldquo;{payload.reason}&rdquo;
        </div>
      ) : null}
    </Card>
  );
}
