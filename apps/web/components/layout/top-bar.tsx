"use client";

import { Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import { FindBar } from "@/components/layout/find-bar";
import { AskPill } from "@/components/layout/ask-pill";
import { AccountMenu } from "@/components/layout/account-menu";
import { NotificationsGlyph } from "@/components/layout/nav-glyphs";
import { DASHBOARD_HEADER_STICKY_CLASS } from "@/components/shared/offline-banner-focus";

/**
 * The 48px top bar: find, notifications, Ask, account.
 *
 * Board option `1b`. What it no longer carries, all from the deletion list
 * (`1t`): the breadcrumb, the page `<h1>`, the per-route primary action button,
 * and the "Search (⌘K)" button. The bar shrank 64px to 48px as a result.
 *
 * **The page title is not here.** The board puts it in this bar's left cell at
 * 15/700; this implementation puts it in the main pane instead, at the left of
 * the page's own toolbar row (`page-header.tsx`), which is what #2141 specifies
 * and what was confirmed for this lane. The left cell is therefore an empty
 * spacer — deliberately, and it still earns its place: the bar is a
 * `1fr auto 1fr` grid, so the find field is centered in the viewport only
 * because the two side cells balance. Replacing the grid with flex, or dropping
 * the empty cell, walks the find field off-center as the right cluster changes
 * width.
 *
 * `DASHBOARD_HEADER_STICKY_CLASS` rather than a bare `sticky top-0`: the header
 * has to sit *under* the OFFLINE/DEGRADED banner instead of covering the only
 * connection signal the app has (#1746).
 */

type TopBarProps = {
  unreadNotifications: number;
  onOpenNotifications: () => void;
  onOpenMobileNav: () => void;
};

/* 34px controls, radius 10, per the board's right cluster. */
const topBarButtonClassName =
  "grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[10px] text-muted-foreground transition hover:bg-card hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25";

export function TopBar({
  unreadNotifications,
  onOpenNotifications,
  onOpenMobileNav,
}: TopBarProps) {
  return (
    <header
      className={cn(
        DASHBOARD_HEADER_STICKY_CLASS,
        "flex h-12 shrink-0 items-center gap-3 border-b border-border bg-surface-1 px-3",
      )}
    >
      {/*
        Left cell. Below `lg` it holds the drawer trigger, which is the only
        way to reach navigation at that width; at `lg` and up it collapses to
        an empty flexible spacer that balances the right cluster.
      */}
      <div className="flex min-w-0 flex-1 items-center">
        <button
          type="button"
          onClick={onOpenMobileNav}
          aria-label="Open navigation menu"
          title="Open navigation menu"
          className={cn(topBarButtonClassName, "lg:hidden")}
        >
          <Menu className="h-[18px] w-[18px]" aria-hidden="true" />
        </button>
      </div>

      {/*
        The find field is 520px at its widest and shrinks rather than pushing
        the bar wider, so the 375px floor holds without a second layout.
      */}
      <FindBar className="w-full max-w-[520px] shrink" />

      <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5">
        <button
          type="button"
          onClick={onOpenNotifications}
          aria-label={
            unreadNotifications > 0
              ? `Notifications (${unreadNotifications} unread)`
              : "Notifications"
          }
          title="Notifications"
          className={cn(topBarButtonClassName, "relative")}
        >
          <NotificationsGlyph className="h-[18px] w-[18px]" />
          {/*
            Gold, not red. The board badges the count in `#DDB844` (`1b`) and
            reserves red for direct address — a mention or a DM (foundations
            §5). A count of unread notifications is not direct address.
          */}
          {unreadNotifications > 0 ? (
            <span
              aria-hidden="true"
              className="absolute right-0.5 top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-1 text-[9.5px] font-bold text-primary-foreground"
            >
              {unreadNotifications > 99 ? "99+" : unreadNotifications}
            </span>
          ) : null}
        </button>
        <AskPill />
        <AccountMenu variant="topbar" />
      </div>
    </header>
  );
}
