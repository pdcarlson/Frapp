"use client";

import { AnnouncementGlyph } from "../chat-glyphs";
import { EYEBROW, MESSAGE_CARD } from "../chip";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@repo/chat-core/types";
import { readAnnouncementBody } from "@repo/chat-core/cards";
import { useMentionChips } from "@repo/hooks/mention-chips";
import { MessageMarkdown } from "./message-markdown";

interface AnnouncementCardProps {
  message: ChatMessage;
}

/**
 * Announcement card: §8 card chrome, muted eyebrow, body at the `body` role.
 *
 * The text is `readAnnouncementBody` from `@repo/chat-core/cards`, which
 * mobile's card reads too: the message's `content` first, which is what the
 * push and the channel preview showed, and `payload.body` only when `content`
 * is empty. It is drawn through the message markdown a plain message uses, so
 * its links, mentions and emphasis read as they would anywhere in chat.
 */
export function AnnouncementCard({ message }: AnnouncementCardProps) {
  const body = readAnnouncementBody(message) ?? "";
  // A token that pinged nobody draws as plain text (`mentionChipFilter`).
  const chips = useMentionChips(message);

  return (
    <Card className={cn(MESSAGE_CARD)}>
      <div
        className={cn(
          EYEBROW,
          "flex items-center gap-1.5 text-muted-foreground",
        )}
      >
        <AnnouncementGlyph className="h-4 w-4" /> Announcement
      </div>
      <div className="mt-2 whitespace-pre-wrap break-words text-base">
        <MessageMarkdown content={body} chips={chips} />
      </div>
    </Card>
  );
}
