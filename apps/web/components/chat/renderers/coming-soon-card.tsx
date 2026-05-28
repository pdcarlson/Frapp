"use client";

import { Hammer } from "lucide-react";
import type { ChatMessage } from "@/lib/chat/types";

interface ComingSoonCardProps {
  message: ChatMessage;
  label?: string;
}

/**
 * Stub renderer for `event` / `task` / `dues` / `points` / `hours` kinds.
 * Chunk 10 sub-chunks swap each kind to a concrete renderer without
 * touching the dispatcher in `./index.tsx`. The card always renders the
 * raw `content` underneath so a misfired hot-path send still surfaces
 * something the user can read.
 */
export function ComingSoonCard({ message, label }: ComingSoonCardProps) {
  return (
    <div className="mt-1 rounded-md border border-dashed bg-muted/20 px-3 py-2">
      <div className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        <Hammer className="h-3 w-3" aria-hidden="true" />
        {label ?? message.kind} renderer coming in Chunk 10
      </div>
      {message.content ? (
        <div className="mt-1 whitespace-pre-wrap break-words text-xs text-muted-foreground">
          {message.content}
        </div>
      ) : null}
    </div>
  );
}
