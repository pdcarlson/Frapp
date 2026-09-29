"use client";

import type { ReactNode } from "react";
import type { ChatMessage } from "@repo/chat-core/types";
import { cn } from "@/lib/utils";
import { DELETED_MESSAGE_PLACEHOLDER } from "@repo/chat-core/reply-preview";
import { MessageMarkdown } from "./message-markdown";

interface TextRendererProps {
  message: ChatMessage;
  /**
   * `(edited)` and the pinned marker, drawn inline after the body's last line
   * (`components.md` §11 § What rides the row). Owned by `MessageItem`, which
   * decides whether a row has any.
   */
  trailing?: ReactNode;
  /** A send still in flight or failed: the body reads as not yet posted. */
  muted?: boolean;
}

/**
 * The body of a plain chat message in the compact layout (`components.md` §11,
 * owner decision 2026-09-29, #2873): `body` type, 16 / 25, with no fill, no
 * border and no padding. It replaced the §11 chat bubble, which is why nothing
 * here is sided or accent-filled any more; whose message it is lives on the
 * row's author line.
 *
 * **The trailing markers ride the last paragraph.** `(edited)` used to live on
 * the author line, which a grouped row does not draw, so an edited follow-on
 * said nothing (#2872). The last paragraph goes inline so the marker sits at
 * the end of its line; where the body ends in a code block the marker drops to
 * its own line under it, rather than breaking the block.
 *
 * **An attachment-only message draws no body.** Its content is empty, and the
 * old bubble painted an empty rounded box above the image. Only a trailing
 * marker, if the row has one, is left to draw.
 *
 * Deleted messages render an explicit placeholder so the timeline never shows
 * stale content.
 */
export function TextRenderer({ message, trailing, muted }: TextRendererProps) {
  if (message.is_deleted) {
    return (
      <div
        data-slot="message-body"
        className="text-base italic leading-[25px] text-muted-foreground"
      >
        {DELETED_MESSAGE_PLACEHOLDER}
      </div>
    );
  }

  if (message.content.trim().length === 0) {
    return trailing ? <div className="leading-[25px]">{trailing}</div> : null;
  }

  return (
    <div
      /*
       * How specs and the cold-load measurement find a message's text
       * (`performance-budgets.md` counts rows by it). A slot, not a class: the
       * editor stands in for this element while it is open.
       */
      data-slot="message-body"
      className={cn(
        "whitespace-pre-wrap break-words text-base leading-[25px]",
        "[&>p:last-of-type]:inline",
        muted ? "text-muted-foreground" : "text-foreground",
      )}
    >
      <MessageMarkdown content={message.content} />
      {trailing}
    </div>
  );
}
