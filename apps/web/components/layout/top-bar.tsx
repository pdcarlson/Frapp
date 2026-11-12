"use client";

import type { ReactElement, ReactNode } from "react";
import Link from "next/link";
import { ChevronRight, Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import { FOCUS_RING_SHELL } from "@/components/ui/focus";
import { FindBar } from "@/components/layout/find-bar";
import { AskPill } from "@/components/layout/ask-pill";
import { AccountMenu } from "@/components/layout/account-menu";
import { ConnectionPill } from "@/components/shared/connection-pill";
import { NotificationsGlyph } from "@/components/layout/nav-glyphs";
import type { PageTitle } from "@/components/layout/page-title";
import { useChatHasUnread } from "@/components/layout/use-chat-has-unread";

/**
 * The 48px top bar: page title, find, notifications, Ask, account.
 *
 * Board option `1b`. What it no longer carries, all from the deletion list
 * (`1t`): the breadcrumb block, the per-route primary action button, and the
 * "Search (⌘K)" button. The bar shrank 64px to 48px as a result.
 *
 * **The page title is here** (2026-11-05, reversing #2141's "titles not in
 * top bar" at the owner's request). It sits in the left cell at 14/700, which
 * is `1f` pin 1 ("Page title in the top bar") before #2141 moved it into each
 * page's toolbar row; back up here, every page gets that row's height back.
 * It is the route's only `<h1>`, derived from the route (`page-title.ts`), so
 * it is there on the loading, offline and error paths too. A page under
 * Settings adds its parent as a link and a chevron, "Chapter settings › Study zones";
 * a top-level route shows its title alone. `/chat` shows "Chat" too, which
 * board `1b` (the chat board) leaves out: one rule for every route beats a
 * chat exception, and the channel name below stays the thread's own `h2`.
 *
 * The left cell still balances the right one: from `lg` both side cells are
 * `flex-1`, so the find field is centered in the viewport only because the two
 * side cells are the same width. Dropping either cell's `flex-1` walks the
 * find field off-center as the title or the right cluster changes width. The
 * title truncates inside that cell rather than pushing the field.
 *
 * **The connection pill lives here** (2026-11-06), first in the right
 * cluster. It used to float just below the bar, over the first row of every
 * page, where it covered chat's channel header. In the bar it covers nothing,
 * and it never resizes the find field: below `xl` it sits in a fixed slot as a
 * dot, and from `xl` the right cell's `flex-1` absorbs its label
 * (`components/shared/connection-pill.tsx`).
 *
 * Not `sticky`. The column this bar heads never scrolls (`<main>` does), so
 * there is nothing to stick to (#1746). No `z-index` either: a positioned,
 * z-indexed bar would be a stacking context capping the find results' `z-50`
 * at the bar's level.
 */

type TopBarProps = {
  /** The open route's title; `null` leaves the cell empty (an unmapped route). */
  pageTitle: PageTitle | null;
  /**
   * The title moves to the tool page's own header from the side-by-side
   * width up (`tool-page-header.tsx`): hidden here by CSS there, so the first
   * paint is right before the width is known.
   */
  titleMovesBesideChat?: boolean;
  /**
   * Whether this copy is the route's `<h1>`. The shell hands the heading to
   * the tool header once it knows the window is wide, so there is one.
   */
  titleIsHeading?: boolean;
  unreadNotifications: number;
  /**
   * Wraps the bell in what it opens: the shell passes the notification
   * dropdown, which anchors under it. Without one the bell is drawn alone.
   */
  notifications?: (bell: ReactElement) => ReactNode;
  onOpenMobileNav: () => void;
};

/* 34px controls, radius 10, per the board's right cluster. */
const topBarButtonClassName = cn(
  "grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[10px] text-muted-foreground transition hover:bg-card hover:text-foreground",
  FOCUS_RING_SHELL,
);

export function TopBar({
  pageTitle,
  titleMovesBesideChat = false,
  titleIsHeading = true,
  unreadNotifications,
  notifications = (bell) => bell,
  onOpenMobileNav,
}: TopBarProps) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-surface-1 px-3">
      {/*
        Left cell. Below `lg` it leads with the drawer trigger, which is the
        only way to reach navigation at that width. It carries the page title,
        shown from `sm` up, which truncates before anything else in the bar
        gives way. From `sm` it is `flex-1` and splits the free space with the
        find field (and balances the right cluster at `lg`); below `sm`, where
        the title is hidden, it is `shrink-0`, only as wide as the trigger, so
        the find field keeps the rest of a phone-width bar.
      */}
      <div className="flex min-w-0 shrink-0 items-center gap-1.5 sm:flex-1 sm:basis-0">
        <MobileNavTrigger onOpen={onOpenMobileNav} />
        {pageTitle ? (
          <PageTitleText
            pageTitle={pageTitle}
            asHeading={titleIsHeading}
            className={cn(
              "sr-only sm:not-sr-only lg:pl-3",
              titleMovesBesideChat && "min-[1056px]:hidden",
            )}
          />
        ) : null}
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
        {/*
          A fixed 28px slot below `xl`, so a pill coming or going never
          resizes the find field: below `lg` this cell is `shrink-0`, and
          between `lg` and `xl` it has no room for the label. From `xl` the
          slot grows to the label inside the cell's `flex-1`.
        */}
        <div className="flex w-7 shrink-0 justify-end xl:w-auto">
          <ConnectionPill placement="top-bar" />
        </div>
        {notifications(
          <button
            type="button"
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
          </button>,
        )}
        <AskPill />
        <AccountMenu variant="topbar" />
      </div>
    </header>
  );
}

/**
 * The drawer trigger, the only route to navigation below `lg`. It carries the
 * nav's unread mark (#3900): the Chat row lights on every page when a message
 * arrives (#3824), and the Direct messages row counts unread conversations
 * (#3774), but below `lg` both sit in a closed drawer, so without a mark here
 * a message landing while the member is on Events showed nothing.
 * Slack's and Discord's phone layouts mark the collapsed nav the same way, on
 * the menu button.
 *
 * - **The same mark as the row it leads to**: a plain dot in `foreground`, not
 *   a count. Red stays reserved for direct address and gold for the
 *   notifications badge beside it (foundations §5). It stands for both chat
 *   rows, so a direct message lights it too, and the drawer then shows the
 *   Chat row's dot, the Direct messages row's red count, or both.
 * - **8px, not the row's 6px, with a 2px cutout** in the bar's own surface.
 *   It sits on the glyph's corner, over the top line's end, and the cutout is
 *   what keeps it a separate mark rather than a blob on the line; it tracks
 *   the button's hover fill so the cutout never shows as a ring.
 * - **Named**: "Open navigation menu, unread messages", the way the collapsed
 *   rail names its lit Chat row.
 *
 * Its own component so the unread reads redraw this button, not the bar or
 * the shell (the counts change with every message the inbox reports).
 */
function MobileNavTrigger({ onOpen }: { onOpen: () => void }) {
  const hasUnread = useChatHasUnread();
  const label = hasUnread
    ? "Open navigation menu, unread messages"
    : "Open navigation menu";
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={label}
      title={label}
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
        "group min-h-touch min-w-touch lg:min-h-0 lg:min-w-0 lg:hidden",
      )}
    >
      <span className="relative">
        <Menu className="block h-[18px] w-[18px]" aria-hidden="true" />
        {hasUnread ? (
          <span
            aria-hidden="true"
            data-menu-unread=""
            className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-foreground ring-2 ring-surface-1 group-hover:ring-card"
          />
        ) : null}
      </span>
    </button>
  );
}

/**
 * The title, with its parent when it has one. The top bar draws it, and from
 * the side-by-side width up the tool page's own header does
 * (`tool-page-header.tsx`).
 *
 * The parent is a quiet link (muted, `label` at 500) and the title the anchor
 * (`label` at 700): the board's 15/700 rounds onto the `label` step and keeps
 * only the weight (#2842). In the top bar `lg:pl-3` lines the title up with
 * the page body's 24px inset below it (12 of bar padding plus 12).
 *
 * **Below `sm` the top bar's copy is visually hidden**, and stays the `<h1>`
 * for a screen reader. The `sr-only` sits on the wrapper, not the `<h1>`:
 * `not-sr-only` resets `overflow` and `white-space`, which on the `<h1>` would
 * undo `truncate` from `sm` up and let a long name wrap the bar. A 390px bar
 * holds the drawer trigger, the find field and the right cluster, and nothing
 * else: sharing it cut the title to "Stud…" and the find field to a bare
 * glyph (measured 2026-11-05). On a phone the drawer marks the open row, and
 * the mobile app, which has its own titles, is the phone surface. Everything
 * is `nowrap` and the title truncates from `sm` up, so a long name never wraps
 * the 48px bar onto a second line.
 *
 * `asHeading` false draws the same words without the `<h1>`, for the copy
 * the shell is not using as the route's heading.
 */
export function PageTitleText({
  pageTitle,
  asHeading = true,
  className,
}: {
  pageTitle: PageTitle;
  asHeading?: boolean;
  className?: string;
}) {
  const { title, parent } = pageTitle;
  const Title = asHeading ? "h1" : "p";
  return (
    <div className={cn("flex min-w-0 items-center gap-1", className)}>
      {parent ? (
        <>
          <Link
            href={parent.href}
            className={cn(
              "hidden shrink-0 rounded-[6px] px-0.5 text-label font-medium text-muted-foreground transition hover:text-foreground sm:inline",
              FOCUS_RING_SHELL,
            )}
          >
            {parent.label}
          </Link>
          <ChevronRight
            className="hidden h-3.5 w-3.5 shrink-0 text-muted-foreground sm:block"
            aria-hidden="true"
          />
        </>
      ) : null}
      <Title className="min-w-0 truncate text-label font-bold text-foreground">
        {title}
      </Title>
    </div>
  );
}
