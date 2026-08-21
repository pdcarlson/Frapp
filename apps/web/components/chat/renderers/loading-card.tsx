"use client";

import { Loader2 } from "lucide-react";
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
 */
export function LoadingCard({ message }: LoadingCardProps) {
  return (
    <div
      className="mt-1 inline-flex items-center gap-2 rounded-md border bg-secondary/30 px-3 py-2 text-sm text-muted-foreground"
      role="status"
      aria-live="polite"
    >
      <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
      <span>{message.content || "Working on it…"}</span>
    </div>
  );
}
