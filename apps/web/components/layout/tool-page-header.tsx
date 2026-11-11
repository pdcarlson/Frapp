"use client";

import { X } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
import { PageTitleText } from "@/components/layout/top-bar";
import type { PageTitle } from "@/components/layout/page-title";

/**
 * The tool page's own header, from the side-by-side width up (Paul,
 * 2026-11-11): the page's title on the left and a close button on the right,
 * 48px like chat's channel header beside it, so the two panels read as a pair
 * the way Slack's channel and its right-hand panel do.
 *
 * It is there because the tool page had no way out of its own. Only a tool
 * with a nav row of its own could be closed, by clicking that row again, and
 * the Settings tools (Chat admin, Study zones, Reports, Discord import),
 * Profile and the personal Settings page have none, so a member who opened
 * Chat admin beside chat was stuck with it. The close button is on every tool
 * page, so whether a page can be closed no longer depends on how it was
 * reached. Escape inside the page and dragging the divider to the right edge
 * close it too (`dashboard-shell.tsx`, `split-divider.tsx`).
 *
 * The title moves here from the top bar at this width, where the top bar's
 * copy sat over chat rather than over the page it named. Below the
 * side-by-side width the shell is a single page, there is nothing to close
 * the page into, and the title stays in the top bar: CSS shows one copy or
 * the other, so the first paint is right before the width is known.
 */
export function ToolPageHeader({
  pageTitle,
  titleIsHeading,
  onClose,
}: {
  pageTitle: PageTitle | null;
  /** Whether this copy is the route's `<h1>` (the shell knows it is wide). */
  titleIsHeading: boolean;
  onClose: () => void;
}) {
  return (
    // A `div`, not a `<header>`: the top bar is the page's one banner.
    <div
      data-tool-page-header=""
      className="hidden h-12 shrink-0 items-center gap-3 border-b border-border px-4 min-[1056px]:flex sm:px-6"
    >
      <div className="flex min-w-0 flex-1 items-center">
        {pageTitle ? (
          <PageTitleText pageTitle={pageTitle} asHeading={titleIsHeading} />
        ) : null}
      </div>
      <IconButton
        label={pageTitle ? `Close ${pageTitle.title}` : "Close page"}
        onClick={onClose}
        className="-mr-2 shrink-0 text-muted-foreground"
      >
        <X className="h-[18px] w-[18px]" aria-hidden="true" />
      </IconButton>
    </div>
  );
}
