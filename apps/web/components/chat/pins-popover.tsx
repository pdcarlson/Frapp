"use client";

import { Pin } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { ChatMessage } from "@/lib/chat/types";

function formatClock(value: string | null | undefined): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    day: "numeric",
  });
}

/**
 * Popover that lists messages flagged `is_pinned`. The popover trigger lives
 * in the channel header; clicking a pinned item scrolls the timeline (the
 * caller wires that via `onJump`).
 */
export function PinsPopover({
  messages,
  onJump,
}: {
  messages: ChatMessage[];
  onJump?: (messageId: string) => void;
}) {
  const pins = messages.filter((message) => message.is_pinned);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          aria-label={`${pins.length} pinned messages`}
        >
          <Pin className="h-4 w-4" />
          {pins.length > 0 ? <span>{pins.length}</span> : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <div className="border-b px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Pinned in this channel
        </div>
        {pins.length === 0 ? (
          <div className="px-3 py-4 text-xs text-muted-foreground">
            Nothing pinned yet. Channel managers can pin key messages.
          </div>
        ) : (
          <ul className="max-h-72 divide-y divide-border/70 overflow-y-auto">
            {pins.map((message) => (
              <li key={message.id} className="px-3 py-2 text-xs">
                <button
                  type="button"
                  onClick={() => onJump?.(message.id)}
                  className="block w-full text-left"
                >
                  <p className="font-semibold">
                    Member {message.sender_id.slice(0, 6)}
                  </p>
                  <p className="text-muted-foreground">
                    {formatClock(message.pinned_at ?? message.created_at)}
                  </p>
                  <p className="mt-1 line-clamp-3 whitespace-pre-wrap">
                    {message.content}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
