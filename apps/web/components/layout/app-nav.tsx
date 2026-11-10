"use client";

import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useHiddenUnsetFeatures } from "@repo/hooks";
import { cn } from "@/lib/utils";
import { ChapterNavHeader } from "@/components/layout/chapter-nav-header";
import { DASHBOARD_NAV, type NavItem } from "@/components/layout/nav-config";
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
   * `column` is the desktop column's modules face (`nav-column.tsx`), which
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
  chatRow?: { onSelect: () => void; open: boolean };
  /**
   * Clicking the open tool's row closes it (#3779). Given, the row whose
   * route is open becomes a button that calls this instead of a link to the
   * page already on screen.
   */
  onCloseTool?: () => void;
  /**
   * Ids of rows with something new for the member (today Chat's unread,
   * `use-chat-has-unread.ts`; the only row the app counts). A highlighted row
   * draws bright and semibold with a dot, on every route and in the drawer,
   * until the count clears (#3824).
   */
  highlighted?: ReadonlySet<string>;
  className?: string;
};

/** What a screen reader hears after a highlighted row's name. */
const HIGHLIGHT_LABEL: Record<string, string> = {
  chat: "unread messages",
};

/** 18px duotone glyph, per `1b` pin 2. */
const navIconClassName = "h-[18px] w-[18px]";

/**
 * A row is the current page when its own route is open, and the current
 * section when a route it owns is (`activeFor`: the Settings tools, which keep
 * their own pages but sit under the Settings row).
 */
function currentFor(
  item: NavItem,
  pathname: string,
): "page" | "true" | undefined {
  if (item.href === pathname) return "page";
  if (item.activeFor?.includes(pathname)) return "true";
  return undefined;
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
  onCloseTool,
  highlighted,
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
        {visibleItems.map((item) => (
          <ProtectedNavItem
            key={item.id}
            item={item}
            current={
              chatRow && item.id === "chat"
                ? chatRow.open
                  ? "true"
                  : undefined
                : currentFor(item, pathname)
            }
            permissions={permissions}
            iconClassName={navIconClassName}
            onNavigate={onNavigate}
            focusClassName={FOCUS_RING_SHELL}
            isModuleEnabled={isModuleEnabled}
            hiddenFeatures={hiddenFeatures}
            collapsed={isCollapsed}
            highlight={
              highlighted?.has(item.id)
                ? (HIGHLIGHT_LABEL[item.id] ?? "new")
                : undefined
            }
            {...(chatRow && item.id === "chat"
              ? {
                  onSelect: chatRow.onSelect,
                  pressed: chatRow.open,
                  selectLabel: chatRow.open ? "Close chat" : "Open chat",
                }
              : onCloseTool &&
                  item.id !== "chat" &&
                  currentFor(item, pathname) !== undefined
                ? {
                    onSelect: onCloseTool,
                    pressed: true,
                    selectLabel: `Close ${item.label}`,
                  }
                : {})}
          />
        ))}
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
        <div
          className={cn(
            "mt-auto flex pt-2",
            isCollapsed ? "justify-center" : "justify-end",
          )}
        >
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label={
              isCollapsed ? "Expand navigation" : "Collapse navigation"
            }
            aria-expanded={!isCollapsed}
            title={isCollapsed ? "Expand navigation" : "Collapse navigation"}
            className={cn(
              "grid h-[34px] w-[34px] place-items-center rounded-[10px] text-muted transition hover:bg-card hover:text-foreground",
              FOCUS_RING_SHELL,
            )}
          >
            <CollapseIcon className="h-[18px] w-[18px]" aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}
