"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

/**
 * A route's actions: its create button, search, filter, an export menu. They
 * sit in the page's own header, between the title and the X (Paul,
 * 2026-11-19: "what if the new minutes button goes up to the Minutes section
 * header next to the x?", then "what if we do that across the board?"), the
 * way Linear, Notion and Slack's right-hand panels put a view's actions in
 * its title row rather than a band of their own under it. The band cost every
 * page a 34px row and pushed the list down for one button.
 *
 * **Where it lands.** From the side-by-side width up the tool page has its own
 * 48px header (`tool-page-header.tsx`), and this renders into that header's
 * action slot through a portal, so a page writes its actions once, inline,
 * next to the state they use. Below that width there is no page header (the
 * title is in the top bar, which already holds find, the bell and the
 * account), so the row stays at the top of the page, trailing-aligned, as it
 * always was.
 *
 * Only actions belong here. A control that needs the page's width to read (a
 * segmented window choice, a month picker) stays in the body: the header is
 * one 48px row with no room to wrap.
 *
 * **An empty row collapses** (`empty:hidden`). Most call sites wrap their
 * controls in a `<Can>`, which renders nothing for a role without the
 * permission and while permissions load; without the collapse those members
 * would get a blank band.
 */

type PageActionsProps = {
  children: React.ReactNode;
  className?: string;
};

/**
 * The tool page header's action slot, or `null` when there is no page header
 * at this width (or outside the shell: a test, a page outside the dashboard).
 */
const PageHeaderSlotContext = React.createContext<HTMLElement | null>(null);

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

/** Whether `PageActions` renders into the page header here. */
export function usePageActionsInHeader(): boolean {
  return React.useContext(PageHeaderSlotContext) !== null;
}

export function PageActions({ children, className }: PageActionsProps) {
  const slot = React.useContext(PageHeaderSlotContext);
  if (slot) {
    return createPortal(
      // One row, never wrapping: the header is 48px. The slot itself
      // shrinks, so a long set of actions squeezes the title (which
      // truncates) before it pushes the X off the edge.
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
