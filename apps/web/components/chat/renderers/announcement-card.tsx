"use client";

import { Megaphone } from "lucide-react";
import type { ChatMessage } from "@repo/chat-core/types";
import type { AnnouncementPayload } from "@repo/chat-integrations";

interface AnnouncementCardProps {
  message: ChatMessage;
}

function readPayload(message: ChatMessage): AnnouncementPayload | null {
  const raw = message.payload;
  if (!raw || typeof raw !== "object") return null;
  const body = (raw as { body?: unknown }).body;
  return typeof body === "string" && body.length > 0 ? { body } : null;
}

/**
 * Announcement card: accent-banded, mono eyebrow, large body. The hot-path
 * `content` field doubles as a fallback when `payload.body` is absent so a
 * stale row from a misbehaving sender never renders an empty card.
 */
export function AnnouncementCard({ message }: AnnouncementCardProps) {
  const payload = readPayload(message);
  const body = payload?.body ?? message.content;

  return (
    <div className="mt-1 rounded-md border-l-4 border-[color:var(--side-accent,#7A5A2F)] bg-[color:var(--mention-bg,theme(colors.amber.50))] px-3 py-2">
      <div className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-[color:var(--side-accent,#7A5A2F)]">
        <Megaphone className="h-3 w-3" aria-hidden="true" /> Announcement
      </div>
      <div className="mt-1 whitespace-pre-wrap break-words text-sm">{body}</div>
    </div>
  );
}
