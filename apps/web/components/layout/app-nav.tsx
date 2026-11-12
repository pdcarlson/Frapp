"use client";

import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useHiddenUnsetFeatures } from "@repo/hooks";
import { cn } from "@/lib/utils";
import { ChapterNavHeader } from "@/components/layout/chapter-nav-header";
import { DASHBOARD_NAV, type NavItem } from "@/components/layout/nav-config";
import type { ChatView } from "@/components/layout/shell-prefs";
import {
  isNavItemVisible,
  ProtectedNavItem,
} from "@/components/layout/protected-nav-item";
import { FOCUS_RING_SHELL } from "@/components/ui/focus";
import { EYEBROW } from "@/components/ui/typography";

/**
 * The module nav: its rows, section headings and the collapse toggle.
 *
 * Row geometry is board option `1b` (expanded) and `1c` (rail), 2px between
 * rows. The width and padding around it are not this component's; they belong
 * to whatever holds it.
 *
 * **It is not the column.** From `lg` up it sits in the shell's left column
 * (`nav-column.tsx`), which owns the width, the surface, the hairline and the
 * pinned chapter row. From the side-by-side width up its Chat row and the open
 * tool's row are toggles (`shell-layout.ts`, #3779). Below `lg` it renders
 * inside the mobile drawer (`variant="drawer"`), with the chapter row on top,
 * always expanded, and no toggle.
 *
 * **Collapsing is a preference**, and also what the shell does while chat and
 * a tool are open side by side on a window too narrow for the full nav
 * (`shell-layout.ts`). The rail never appears in the drawer.
 *
 * Section headings are derived, never declared — a heading renders only when at
 * least one of its items survives the permission, module and setup gates, so a
 * heading never announces a group the viewer cannot open. In the rail
 * there is no room for a heading at all, so grouping falls back to the hairline
 * dividers the board draws between rail groups (`1c` pin 1).
 */

type AppNavProps = {
  collapsed: boolean;
  onToggleCollapsed?: () => void;
  permissions: readonly string[] | null | undefined;
  isModuleEnabled?: (moduleKey: string) => boolean;
  pathname: string;
  onNavigate?: () => void;
  /**
   * `column` is the desktop shell's left column (`nav-column.tsx`), which
   * pins the chapter row above it. The drawer reuses this component wholesale
   * rather than duplicating the nav ("the drawer is the sidebar"), with the
   * chapter row on top, no collapse toggle and no rail.
   */
  variant?: "column" | "drawer";
  /**
   * The desktop shell's Chat row from the side-by-side width up
   * (`shell-layout.ts`, #3779): a toggle that opens and closes the chat panel
   * instead of a link to `/chat`. `open` marks it the way a current row is
   * marked. Absent, the row is the plain link it is below that width.
   */
  chatRow?: {
    onSelect: (view: ChatView) => void;
    open: boolean;
    /** Which list the open panel shows (#3774). */
    view: ChatView;
  };
  /**
   * Which list chat shows, for the two chat rows when they are links (below
   * the side-by-side width, and in the drawer): the row for the list on
   * screen at `/chat` is the current page, and Chat links back to channels
   * from Direct messages (#3774).
   */
  chatView?: ChatView;
  /**
   * Clicking the open tool's row closes it (#3779). Given, the row whose
   * route is open becomes a button that calls this instead of a link to the
   * page already on screen.
   */
  onCloseTool?: () => void;
  /**
   * Ids of rows with something new for the member (today Chat's unread
   * channels, `use-chat-has-unread.ts`; Direct messages carries a count
   * instead, `counts` below). A highlighted row
   * draws bright and semibold with a dot, on every route and in the drawer,
   * until the count clears (#3824).
   */
  highlighted?: ReadonlySet<string>;
  /** Rows with a mention-red count (today Direct messages, #3774). */
  counts?: ReadonlyMap<string, number>;
  className?: string;
};

/**
 * The two rows that open the chat panel (#3774): Chat on the chapter's
 * channels, Direct messages on the member's conversations.
 */
const CHAT_ROW_VIEW: Readonly<Record<string, ChatView>> = {
  chat: "channels",
  direct: "direct",
};

/** The toggle's action, as its tooltip and pressed state name it. */
const CHAT_ROW_ACTION: Readonly<Record<ChatView, [string, string]>> = {
  channels: ["Open chat", "Close chat"],
  direct: ["Open direct messages", "Close direct messages"],
};

/** What a screen reader hears after a counted row's name. */
function countLabel(id: string, value: number): string {
  if (id === "direct") {
    return value === 1
      ? "1 unread conversation"
      : `${value} unread conversations`;
  }
  return `${value} new`;
}

/** What a screen reader hears after a highlighted row's name. */
const HIGHLIGHT_LABEL: Record<string, string> = {
  chat: "unread messages",
};

/** The collapse toggle's action, named as the sidebar it folds (#4044). */
const TOGGLE_LABEL = {
  collapse: "Collapse sidebar",
  expand: "Expand sidebar",
} as const;

/** 18px duotone glyph, per `1b` pin 2. */
const navIconClassName = "h-[18px] w-[18px]";

/**
 * A row is the current page when its own route is open. The officer tools
 * that once kept routes of their own under the Settings row now open inside
 * Chapter settings (#3837), so no row stands for another route any more.
 */
function currentFor(item: NavItem, pathname: string): "page" | undefined {
  return item.href === pathname ? "page" : undefined;
}

export function AppNav({
  collapsed,
  onToggleCollapsed,
  permissions,
  isModuleEnabled,
  pathname,
  onNavigate,
  variant = "column",
  chatRow,
  chatView = "channels",
  onCloseTool,
  highlighted,
  counts,
  className,
}: AppNavProps) {
  const isDrawer = variant === "drawer";
  // The drawer has no room to be a rail and no toggle to leave it, so it is
  // always expanded regardless of the stored preference.
  const isCollapsed = collapsed && !isDrawer;
  // Study hours with no active zone, and Documents with nothing in it for a
  // viewer who can't upload, leave the nav (`nav-config.ts`, Setup gating).
  const hiddenFeatures = useHiddenUnsetFeatures(permissions, isModuleEnabled);

  const sections = DASHBOARD_NAV.map((section) => {
    const visibleItems = section.items.filter((item) =>
      isNavItemVisible(item, permissions, isModuleEnabled, hiddenFeatures),
    );
    if (visibleItems.length === 0) return null;

    return (
      <div
        key={section.id}
        className={cn(
          "flex flex-col gap-0.5",
          isCollapsed && "items-center",
          // The unlabeled Directory + Billing group has no heading to separate
          // it from Resources above, so it carries its own top margin.
          section.anchor && section.id !== "anchor" && "mt-3.5",
        )}
      >
        {isCollapsed ? (
          // Rail grouping is a hairline, since a heading has nowhere to go.
          // Not before the first group, which needs no separation from the
          // chapter row above it.
          section.id !== "anchor" ? (
            <span
              aria-hidden="true"
              className="my-2 h-px w-6 shrink-0 bg-border"
            />
          ) : null
        ) : section.anchor ? null : (
          <p className={cn("px-2.5 pb-1 pt-3.5 text-muted", EYEBROW)}>
            {section.label}
          </p>
        )}
        {visibleItems.map((item) => {
          const rowView = CHAT_ROW_VIEW[item.id];
          const count = counts?.get(item.id);
          const shared = {
            permissions,
            iconClassName: navIconClassName,
            onNavigate,
            focusClassName: FOCUS_RING_SHELL,
            isModuleEnabled,
            hiddenFeatures,
            collapsed: isCollapsed,
            highlight: highlighted?.has(item.id)
              ? (HIGHLIGHT_LABEL[item.id] ?? "new")
              : undefined,
            count: count
              ? { value: count, label: countLabel(item.id, count) }
              : undefined,
          };
          if (rowView && chatRow) {
            // A toggle from the side-by-side width up: the row of the list
            // on screen closes the panel, the other switches it in place.
            const open = chatRow.open && chatRow.view === rowView;
            const [openLabel, closeLabel] = CHAT_ROW_ACTION[rowView];
            return (
              <ProtectedNavItem
                key={item.id}
                item={item}
                current={open ? "true" : undefined}
                onSelect={() => chatRow.onSelect(rowView)}
                pressed={open}
                selectLabel={open ? closeLabel : openLabel}
                {...shared}
              />
            );
          }
          if (rowView) {
            // A link: both rows go to `/chat`, so the list on screen says
            // which of them is the current page.
            const here = pathname === "/chat" && chatView === rowView;
            const linked =
              item.id === "chat" && chatView === "direct"
                ? { ...item, href: "/chat?view=channels" }
                : item;
            return (
              <ProtectedNavItem
                key={item.id}
                item={linked}
                current={here ? "page" : undefined}
                {...shared}
              />
            );
          }
          return (
            <ProtectedNavItem
              key={item.id}
              item={item}
              current={currentFor(item, pathname)}
              {...shared}
              {...(onCloseTool && currentFor(item, pathname) === "page"
                ? {
                    // Only the row whose own page is open.
                    onSelect: onCloseTool,
                    pressed: true,
                    selectLabel: `Close ${item.label}`,
                  }
                : {})}
            />
          );
        })}
      </div>
    );
  });

  const CollapseIcon = isCollapsed ? PanelLeftOpen : PanelLeftClose;

  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col",
        isCollapsed && "items-center",
        className,
      )}
    >
      {isDrawer ? (
        <ChapterNavHeader collapsed={false} onNavigate={onNavigate} />
      ) : null}
      <nav
        aria-label="Primary"
        className={cn(
          "mt-1 flex min-h-0 flex-1 flex-col overflow-y-auto",
          isCollapsed && "items-center",
        )}
      >
        {sections}
      </nav>
      {isDrawer || !onToggleCollapsed ? null : (
        /*
         * The collapse toggle (#4044). It stays pinned to the bottom of the
         * column (board `1c` pin 2, `1b` pin 4), but reads as a nav row: a hairline
         * above it, the row's 34px geometry and colors, and in the expanded
         * column its action as a visible label ("Collapse sidebar"), the way
         * WordPress's "Collapse menu" row does. It was a lone 34px
         * `text-muted` glyph in the corner, which members missed. The rail
         * has no room for a label, so there the name is the accessible name
         * and the tooltip.
         */
        <div
          data-nav-toggle=""
          className={cn(
            "mt-auto flex shrink-0 flex-col pt-2",
            isCollapsed ? "items-center" : "w-full",
          )}
        >
          {/* The rail's 24px group hairline; the column's spans the row. */}
          <span
            aria-hidden="true"
            className={cn(
              "mb-2 h-px shrink-0 bg-border",
              isCollapsed ? "w-6" : "w-full",
            )}
          />
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label={isCollapsed ? TOGGLE_LABEL.expand : undefined}
            aria-expanded={!isCollapsed}
            title={isCollapsed ? TOGGLE_LABEL.expand : TOGGLE_LABEL.collapse}
            className={cn(
              "flex h-[34px] shrink-0 items-center rounded-[10px] text-sm text-muted-foreground transition hover:bg-card hover:text-foreground",
              isCollapsed ? "w-[34px] justify-center" : "w-full gap-2.5 px-2.5",
              FOCUS_RING_SHELL,
            )}
          >
            <CollapseIcon className={navIconClassName} aria-hidden="true" />
            {isCollapsed ? null : (
              <span className="truncate">{TOGGLE_LABEL.collapse}</span>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
