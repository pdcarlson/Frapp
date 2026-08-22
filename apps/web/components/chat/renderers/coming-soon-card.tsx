"use client";

import { EYEBROW } from "../chip";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@repo/chat-core/types";

interface ComingSoonCardProps {
  message: ChatMessage;
  label?: string;
}

/**
 * Placeholder renderer for the kinds that are in `CHAT_MESSAGE_KINDS` but have
 * no card yet — `dues` and `hours`, per the dispatcher in `./index.tsx`. The
 * docstring used to list `event`, `task` and `points` too, and the copy still
 * said "coming in Chunk 10"; all three shipped their own renderers long ago,
 * and chunks are not a unit anything else in the repo still counts in.
 *
 * The card always renders the raw `content` underneath so a misfired hot-path
 * send still surfaces something the user can read.
 */
export function ComingSoonCard({ message, label }: ComingSoonCardProps) {
  return (
    <div className="mt-1 rounded-lg border border-dashed border-border p-4">
      <p className={cn(EYEBROW, "text-muted-foreground")}>
        {label ?? message.kind} · not built yet
      </p>
      {message.content ? (
        <div className="mt-2 whitespace-pre-wrap break-words text-base text-muted-foreground">
          {message.content}
        </div>
      ) : null}
    </div>
  );
}
