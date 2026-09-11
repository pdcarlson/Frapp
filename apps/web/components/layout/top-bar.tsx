"use client";

import { Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import { FOCUS_RING_SHELL } from "@/components/ui/focus";
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
const topBarButtonClassName = cn(
  "grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[10px] text-muted-foreground transition hover:bg-card hover:text-foreground",
  FOCUS_RING_SHELL,
);

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
      <div className="flex min-w-0 shrink-0 items-center lg:flex-1">
        <button
          type="button"
          onClick={onOpenMobileNav}
          aria-label="Open navigation menu"
          title="Open navigation menu"
          /*
           * `lg:hidden` means this control exists ONLY on the touch tier, where
           * the 44px floor binds - and below `lg` it is the only route to
           * navigation at all. It is the one top-bar control that cannot take
           * the board's 34px pointer geometry.
           */
          className={cn(
            topBarButtonClassName,
            // `min-h-touch`/`min-w-touch`, not `h-touch`: only the min-* keys
            // are bound to `--touch-min` in the Tailwind config, and an unknown
            // key compiles to nothing at all rather than erroring (#1145).
            "min-h-touch min-w-touch lg:min-h-0 lg:min-w-0 lg:hidden",
          )}
        >
          <Menu className="h-[18px] w-[18px]" aria-hidden="true" />
        </button>
      </div>

      {/*
        `flex-1 basis-*`, NOT `w-full`.

        `w-full` makes the field's flex BASE SIZE the full width of the bar, so
        below roughly 568px the hypothetical main size already overflows, there
        is no free space to distribute, and both `flex-1 min-w-0` side cells
        resolve to 0px. The field's opaque background then paints over the
        `lg:hidden` drawer trigger — which below `lg` is the only route to
        navigation at all — and the right cluster overflows back across it.
        A basis of 0 with `flex-1` lets all three cells share the line.
      */}
      <FindBar className="min-w-0 flex-1 basis-0 sm:max-w-[520px]" />

      <div className="flex shrink-0 items-center justify-end gap-1.5 lg:min-w-0 lg:flex-1">
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
            Fixed gold, and deliberately NOT `bg-primary`.

            `--primary` is the per-tenant accent slot, so painting the badge
            with it is the same house-tenant mistake the Ask pill documents:
            on a chapter seeded a red accent this badge becomes visually
            identical to the fixed `#E5484D` mention/DM badge, and a member
            can no longer tell "3 notifications" from "3 people addressed me".
            The board draws it in mark gold (`1b`). This uses `--gold-house`,
            the existing "never retints per chapter" brand slot, rather than
            adding a second fixed-gold token for one badge; the two differ by
            a step of hue and the load-bearing property (fixed, not tenant) is
            identical. Red stays reserved for direct address (foundations §5).
          */}
          {unreadNotifications > 0 ? (
            <span
              aria-hidden="true"
              className="absolute right-0.5 top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-gold-house px-1 text-[9.5px] font-bold text-gold-on-house"
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
