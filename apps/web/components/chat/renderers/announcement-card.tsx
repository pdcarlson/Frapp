"use client";

import { AnnouncementGlyph } from "../chat-glyphs";
import { EYEBROW, MESSAGE_CARD } from "../chip";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
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
 * Announcement card: §8 card chrome, accent eyebrow, body at the `body` role.
 * The hot-path
 * `content` field doubles as a fallback when `payload.body` is absent so a
 * stale row from a misbehaving sender never renders an empty card.
 */
export function AnnouncementCard({ message }: AnnouncementCardProps) {
  const payload = readPayload(message);
  const body = payload?.body ?? message.content;

  return (
    <Card className={cn(MESSAGE_CARD)}>
      <div className={cn(EYEBROW, "flex items-center gap-1.5 text-accent-text")}>
        <AnnouncementGlyph className="h-4 w-4" /> Announcement
      </div>
      <div className="mt-2 whitespace-pre-wrap break-words text-base">{body}</div>
    </Card>
  );
}
