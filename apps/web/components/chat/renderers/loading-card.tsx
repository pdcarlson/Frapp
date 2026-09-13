"use client";

import { Skeleton } from "@/components/shared/async-states";
import { EYEBROW, MESSAGE_CARD } from "../chip";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@repo/chat-core/types";

interface LoadingCardProps {
  message: ChatMessage;
}

/**
 * Placeholder card inserted optimistically by heavy slash commands
 * (`/dues remind overdue`, …). The server replaces the row's `kind` +
 * `payload` over Realtime UPDATE; `mergeServerRow` carries that mutation
 * through `chat_messages` event "*" subscription so this card swaps in
 * place for the final renderer with no re-render trickery.
 *
 * The hot-path `content` field can carry a short status string
 * ("Computing overdue list…") that surfaces here.
 *
 * **Content-shaped, not a spinner.** components.md §10 rules out
 * "spinner-in-a-box" outright and asks a skeleton to mirror the layout it
 * becomes — which here is one of the rich cards: an eyebrow line and a body.
 * The shimmer is the shared `.skeleton-shimmer` recipe, so its sweep stays in
 * phase with every other skeleton on the surface.
 */
export function LoadingCard({ message }: LoadingCardProps) {
  // A heavy command whose response was lost keeps `kind: "loading"` — only its
  // `_status` changes (#1733) — so this renderer is what an `unconfirmed` row
  // draws. `recorded` (#1789) is the other terminal form: the write committed
  // and the card did not. Both must stop looking busy: a shimmer under
  // `aria-busy` reads as "still working".
  const isUnconfirmed = message._status === "unconfirmed";
  const isRecorded = message._status === "recorded";
  const isTerminal = isUnconfirmed || isRecorded;

  return (
    <Card
      className={cn(MESSAGE_CARD)}
      // Only a genuinely in-flight placeholder is a live status. A terminal
      // row leaving the region here would give the row two populated live
      // regions (this card and the note beside the footer), which in a
      // virtualized list re-announces both on every scroll pass.
      role={isTerminal ? undefined : "status"}
      aria-live={isTerminal ? undefined : "polite"}
      aria-busy={isTerminal ? undefined : "true"}
    >
      <p className={cn(EYEBROW, "text-muted-foreground")}>
        {isRecorded
          ? `${message.content || "That command"}: recorded, chat card missing`
          : isUnconfirmed
            ? `${message.content || "That command"}: outcome unknown`
            : message.content || "Working on it…"}
      </p>
      {isTerminal ? null : (
        <div className="mt-2 flex flex-col gap-2" aria-hidden="true">
          <Skeleton className="h-[13px] w-[62%]" />
          <Skeleton className="h-[13px] w-[45%]" />
        </div>
      )}
    </Card>
  );
}
