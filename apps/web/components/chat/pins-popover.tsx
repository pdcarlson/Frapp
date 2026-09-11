"use client";

import { FOCUS_RING } from "@/components/ui/focus";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@repo/chat-core/types";
import { resolveAuthorLabel } from "@repo/hooks";
import { formatClock } from "@repo/formatting";
import { replyPreviewText } from "./reply-quote";

/**
 * Panel listing messages flagged `is_pinned`, rendered inside the channel
 * overflow menu (`channel-menu.tsx`); picking a row scrolls the timeline to
 * that message. The menu owns the popover, its trigger and the dismissal, so
 * this file is content only.
 *
 * **`onJump` is wired now.** It was optional and the shell never passed it, so
 * every row here was a `<button>` that did nothing — a control that silently
 * does nothing is the dead end components.md §5 bans, and repainting it would
 * only have made a prettier one. `MessageTimeline` exposes the scroll through
 * its ref; a pin older than the loaded window still cannot be reached, and the
 * timeline no-ops rather than pretending.
 */
/**
 * The pinned subset, exported because two surfaces need the same answer: this
 * panel, and the count on the `⋯` menu row that opens it. A second copy of the
 * predicate drifts the first time the rule gains a clause — a tombstoned
 * message keeps `is_pinned`, so the obvious next clause is excluding deleted
 * ones, and a menu row reading "Pinned, 3" over a panel listing 2 is the shape
 * that bug takes.
 */
export function pinnedMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.filter((message) => message.is_pinned);
}

export function PinsPanel({
  messages,
  nameFor,
  onJump,
}: {
  messages: ChatMessage[];
  /** Resolves `users.id` → display name; `null` when unresolvable. */
  nameFor: (userId: string) => string | null;
  onJump?: (messageId: string) => void;
}) {
  const pins = pinnedMessages(messages);
  return (
    <>
      {pins.length === 0 ? (
        <p className="px-3 py-4 text-[12.5px] text-muted-foreground">
          Nothing pinned yet. Channel managers can pin key messages.
        </p>
      ) : (
        <ul className="max-h-72 divide-y divide-border overflow-y-auto">
          {pins.map((message) => (
            <li key={message.id}>
              <button
                type="button"
                onClick={() => {
                  // Jumping must also dismiss the menu: a 320px panel left open
                  // over the pane it just scrolled hides the message it
                  // navigated to — a defect the previously-inert rows could not
                  // expose. The popover is the host's now, so `channel-menu.tsx`
                  // closes it around this callback; the row only reports the jump.
                  onJump?.(message.id);
                }}
                className={cn(
                  "block w-full px-3 py-3 text-left text-[12.5px] transition-colors",
                  "hover:bg-accent-subtle hover:text-accent-text",
                  FOCUS_RING,
                )}
              >
                <span className="block font-semibold text-foreground">
                  {/* viewerId is deliberately null: the pins list names every
                      author, including the viewer, rather than saying "You" —
                      which is the behaviour this panel already had. */}
                  {resolveAuthorLabel(message, nameFor, null)}
                </span>
                <span className="block text-muted-foreground">
                  {formatClock(message.pinned_at ?? message.created_at)}
                </span>
                {/*
                  The pin's body is a message, and foundations §7 is a hard
                  MUST NOT on body text below 16 — the surrounding metadata is
                  caption-sized, the prose is not.
                */}
                <span className="mt-1 line-clamp-3 block whitespace-pre-wrap text-base text-muted-foreground">
                  {replyPreviewText(message)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
