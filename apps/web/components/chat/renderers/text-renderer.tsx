"use client";

import type { ChatMessage } from "@repo/chat-core/types";

interface TextRendererProps {
  message: ChatMessage;
  isSelf: boolean;
}

/**
 * Default text bubble. Extracted out of `message-item.tsx` so the renderer
 * registry can dispatch on `message.kind`. Deleted messages render an
 * explicit "[message deleted]" placeholder so the timeline never shows
 * stale content.
 */
export function TextRenderer({ message, isSelf }: TextRendererProps) {
  return (
    <div
      className={`mt-0.5 inline-block max-w-full whitespace-pre-wrap break-words text-sm ${
        message.is_deleted ? "italic text-muted-foreground" : ""
      } ${
        isSelf && !message.is_deleted
          ? "rounded-md bg-[color:var(--chat-self-bubble,theme(colors.primary.50))] px-2 py-1"
          : ""
      }`}
    >
      {message.is_deleted ? "[message deleted]" : message.content}
    </div>
  );
}
