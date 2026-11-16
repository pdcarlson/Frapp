"use client";

import type { ReactNode } from "react";
import { FOCUS_RING } from "@/components/ui/focus";
import { cn } from "@/lib/utils";

/**
 * The row the chat's message lists share (#1566): an author, a time and a
 * clamped body, as a button that jumps to the message. `PinsPanel` and
 * `BookmarksPanel` render `MessageListRow` inside `MESSAGE_LIST_CLASS`;
 * `ChatSearchPanel` draws its own header lines and list height, so it takes
 * only the button class and the body.
 */

/** The list both channel-menu panels scroll inside. Search is taller (#3859). */
export const MESSAGE_LIST_CLASS =
  "max-h-72 divide-y divide-border overflow-y-auto";

/** Room on the right for a row's trailing control (bookmarks' Remove). */
const ROW_LAYOUT = {
  plain: "block w-full px-3 py-3 text-left text-caption",
  trailing: "block w-full py-3 pl-3 pr-11 text-left text-caption",
} as const;

/** The jump button's classes, with or without room for a trailing control. */
export function messageRowButtonClass(reserveTrailing = false): string {
  return cn(
    `${ROW_LAYOUT[reserveTrailing ? "trailing" : "plain"]} transition-colors`,
    "hover:bg-card-hover hover:text-foreground",
    FOCUS_RING,
  );
}

/**
 * The message's body. foundations §7 is a hard MUST NOT on body text below
 * 16: the surrounding metadata is caption-sized, the prose is not. `italic`
 * marks a string nobody typed (a tombstone, a redaction).
 */
export function MessageRowBody({
  italic = false,
  children,
}: {
  italic?: boolean;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "mt-1 line-clamp-3 block whitespace-pre-wrap text-base text-muted-foreground",
        italic && "italic",
      )}
    >
      {children}
    </span>
  );
}

export function MessageListRow({
  author,
  time,
  body,
  italic = false,
  onJump,
  inert = false,
  reserveTrailing = false,
  trailing,
}: {
  author: ReactNode;
  time: string;
  body: ReactNode;
  italic?: boolean;
  onJump: () => void;
  /** A static row, not a button: there is nowhere to jump to. */
  inert?: boolean;
  /**
   * Pads the row for a control absolutely positioned on its right, and makes
   * the `li` its positioning context, so the control never overlaps the text.
   */
  reserveTrailing?: boolean;
  trailing?: ReactNode;
}) {
  const content = (
    <>
      <span className="block font-semibold text-foreground">{author}</span>
      <span className="block text-muted-foreground">{time}</span>
      <MessageRowBody italic={italic}>{body}</MessageRowBody>
    </>
  );
  return (
    <li className={reserveTrailing ? "relative" : undefined}>
      {inert ? (
        <div className={ROW_LAYOUT[reserveTrailing ? "trailing" : "plain"]}>
          {content}
        </div>
      ) : (
        <button
          type="button"
          onClick={onJump}
          className={messageRowButtonClass(reserveTrailing)}
        >
          {content}
        </button>
      )}
      {trailing}
    </li>
  );
}
