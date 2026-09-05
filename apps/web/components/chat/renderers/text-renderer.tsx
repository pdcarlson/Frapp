"use client";

import type { ChatMessage } from "@repo/chat-core/types";
import { cn } from "@/lib/utils";
import { DELETED_MESSAGE_PLACEHOLDER } from "../message-placeholders";
import { MessageMarkdown } from "./message-markdown";

interface TextRendererProps {
  message: ChatMessage;
  isSelf: boolean;
}

/**
 * The chat message bubble — one of the two signature Signet surfaces
 * (`components.md` §11, drawn in `canvas-screens.dc.html` s05 and panel 4e of
 * `signet-design-system.dc.html`).
 *
 * | | fill | border | text | tail |
 * | --- | --- | --- | --- | --- |
 * | Incoming | `--card` | hairline | `--foreground` | bottom-left |
 * | Self | `--primary` | none | `--primary-foreground` | bottom-right |
 *
 * **The self bubble is the one place a message takes the chapter accent.**
 * Incoming bubbles stay neutral under every seed, so "mine vs theirs" survives
 * any accent — and the pair is `--primary` / `--primary-foreground`, which the
 * accent engine guarantees together (`accent-engine.md` §8), never a hand-picked
 * foreground over a tenant fill.
 *
 * **Radius 18 with the tail corner at 6** is the locked bubble radius
 * (foundations.md §8), and neither value is on the Tailwind radius scale — the
 * arbitrary values are the spec, not a shortcut past it. The tail points back at
 * its sender: bottom-left incoming, bottom-right self.
 *
 * s05 draws the self bubble's body at weight 500, outside the locked 400/600/700
 * set, so it renders at the body weight (§11 says so outright).
 *
 * Deleted messages render an explicit placeholder so the timeline never shows
 * stale content, and they never take a bubble: a tombstone is not something
 * anyone said.
 */
export function TextRenderer({ message, isSelf }: TextRendererProps) {
  if (message.is_deleted) {
    return (
      <div className="mt-1 text-base italic text-muted-foreground">
        {DELETED_MESSAGE_PLACEHOLDER}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "mt-1 inline-block max-w-full whitespace-pre-wrap break-words",
        // s05 draws 11/14 padding and a 23px line box. components.md §1 is
        // explicit that the maps win over drawn measurements, so those round
        // onto foundations' 4px grid (§9) and its `body` role (§7): 12/16
        // padding, 16/25 type.
        "px-4 py-3 text-base leading-[25px]",
        isSelf
          ? "rounded-[18px] rounded-br-[6px] bg-primary text-primary-foreground"
          : "rounded-[18px] rounded-bl-[6px] border border-border bg-card text-foreground",
      )}
    >
      <MessageMarkdown content={message.content} />
    </div>
  );
}
