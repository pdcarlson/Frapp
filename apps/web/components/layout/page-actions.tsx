"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

/**
 * A route's actions: its create button, an upload, its search and filter
 * when they fit as buttons (Events'), an export menu. They sit in the page's
 * own header, between the title and the X (Paul, 2026-11-19: "what if the new
 * minutes button goes up to the Minutes section header next to the x?", then
 * "what if we do that across the board?"), the way Linear, Notion and
 * Slack's right-hand panels put a view's actions in its title row rather than
 * a band of their own under it. The band cost every page a 34px row and
 * pushed the list down for one button.
 *
 * **Always the header, inside the shell.** The page writes its actions once,
 * inline, next to the state they use, and this portals them into the tool
 * page header's action slot (`tool-page-header.tsx`). The slot is the same box
 * at every width, so nothing remounts when the window crosses the
 * side-by-side width (a half-filled Log service form keeps its draft). From
 * that width up the header is title, actions, X. Below it the title is in the
 * top bar and there is nothing to close into, so the header shows only when
 * it holds actions, as one pinned row of them. The header's CSS decides that,
 * not a media query in JS, so no width has to be known first.
 *
 * On the server, and for the one commit before the slot mounts, it renders
 * nothing. From the side-by-side width up the header row is already drawn at
 * its 48px, so the actions fill in place and nothing under them moves. Below
 * it the row appears with them, once, on load; it no longer arrives in the
 * body and then jumps into the header, which is what a media-query switch did.
 *
 * Only actions belong here. A control that needs the page's width to read (a
 * segmented window choice, a search field with filter chips beside it) stays
 * in the body: the header is one 48px row with no room to wrap.
 *
 * Outside the shell (a test, a page with no tool header) it renders inline as
 * a trailing row.
 *
 * **An empty row collapses** (`empty:hidden`). Most call sites wrap their
 * controls in a `<Can>`, which renders nothing for a role without the
 * permission and while permissions load; the header's `:has()` rule then
 * keeps a narrow window from drawing an empty band.
 */

type PageActionsProps = {
  children: React.ReactNode;
  className?: string;
};

/**
 * The tool page header's action slot. `undefined` outside the shell (no
 * provider); `null` inside it until the slot has mounted.
 */
const PageHeaderSlotContext = React.createContext<
  HTMLElement | null | undefined
>(undefined);

export function PageHeaderSlotProvider({
  slot,
  children,
}: {
  slot: HTMLElement | null;
  children: React.ReactNode;
}) {
  return (
    <PageHeaderSlotContext.Provider value={slot}>
      {children}
    </PageHeaderSlotContext.Provider>
  );
}

export function PageActions({ children, className }: PageActionsProps) {
  const slot = React.useContext(PageHeaderSlotContext);
  if (slot === null) return null;
  if (slot) {
    return createPortal(
      // One row, never wrapping: the header is 48px. Buttons that can say
      // less there do (`NewButton` drops to its +) so the title keeps room.
      <div
        data-page-actions="header"
        className="flex min-w-0 items-center justify-end gap-2 empty:hidden"
      >
        {children}
      </div>,
      slot,
    );
  }
  return (
    /*
      `flex-wrap` is what holds the 375px floor: a segmented control plus a
      button wraps onto a second line inside the row instead of running past
      the screen edge (Points at 390px, 2026-11-05).
    */
    <div
      data-page-actions="body"
      className={cn(
        "flex min-h-[34px] max-w-full flex-wrap items-center justify-end gap-2 empty:hidden",
        className,
      )}
    >
      {children}
    </div>
  );
}
