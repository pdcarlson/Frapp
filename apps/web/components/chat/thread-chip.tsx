"use client";

import { useEffect, useState } from "react";
import { MessagesSquare } from "lucide-react";
import { threadChipLabel } from "@repo/chat-core/threads";
import type { ThreadSummary } from "@repo/chat-core/types";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { FOCUS_RING } from "@/components/ui/focus";
import { cn, initials } from "@/lib/utils";

/** The row's Start thread icon (#3785). */
export function StartThreadGlyph({ className }: { className?: string }) {
  return <MessagesSquare className={className} aria-hidden="true" />;
}

/** How often the chip's "last reply 5m ago" is re-read. */
const CHIP_TICK_MS = 60_000;

/**
 * Under a message that has thread replies (#3785): up to three repliers,
 * "N replies" in the accent and "last reply 5m ago". Opens the thread.
 */
export function ThreadChip({
  summary,
  nameFor,
  onOpen,
}: {
  summary: ThreadSummary;
  nameFor: (userId: string) => string | null;
  onOpen?: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const handle = setInterval(() => setNow(Date.now()), CHIP_TICK_MS);
    return () => clearInterval(handle);
  }, []);
  const { replies, lastReply } = threadChipLabel(
    summary.reply_count,
    summary.last_reply_at,
    now,
  );
  const content = (
    <>
      {summary.recent_sender_ids.length > 0 ? (
        <span className="flex -space-x-1.5" aria-hidden="true">
          {summary.recent_sender_ids.map((id) => (
            <Avatar key={id} className="h-5 w-5 border border-card">
              <AvatarFallback className="text-[9px]">
                {initials(nameFor(id) ?? "?")}
              </AvatarFallback>
            </Avatar>
          ))}
        </span>
      ) : null}
      <span className="font-medium text-primary">{replies}</span>
      {lastReply ? (
        <span className="text-muted-foreground">{lastReply}</span>
      ) : null}
    </>
  );
  const className =
    "mt-1 inline-flex items-center gap-2 rounded-md px-1.5 py-0.5 text-caption";
  if (!onOpen) return <div className={className}>{content}</div>;
  return (
    <button
      type="button"
      className={cn(className, "hover:bg-muted", FOCUS_RING)}
      aria-label={`${replies}${lastReply ? `, ${lastReply}` : ""}. Open thread`}
      onClick={onOpen}
    >
      {content}
    </button>
  );
}
