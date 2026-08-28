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
  return (
    <Card
      className={cn(MESSAGE_CARD)}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <p className={cn(EYEBROW, "text-muted-foreground")}>
        {message.content || "Working on it…"}
      </p>
      <div className="mt-2 flex flex-col gap-2" aria-hidden="true">
        <Skeleton className="h-[13px] w-[62%]" />
        <Skeleton className="h-[13px] w-[45%]" />
      </div>
    </Card>
  );
}
