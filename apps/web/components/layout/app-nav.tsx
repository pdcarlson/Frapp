"use client";

import type { ReactNode } from "react";
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
 * **It is not the column.** From `lg` up it is the modules face of the
 * shell's one left column (`nav-column.tsx`), which owns the width, the
 * surface, the hairline and the pinned chapter row. On `/chat` the column also
 * holds the channel list, and this nav slides in over it from a back arrow.
 * Below `lg` it renders inside the mobile drawer (`variant="drawer"`), with the
 * chapter row on top, always expanded, and no toggle.
 *
 * **Collapsing is a preference, not a breakpoint.** The responsive contract is
 * still two states switching once at `lg` (`spec/ui/web-dashboard/README.md`):
 * the rail never appears in the drawer. Adding a viewport tier would be a spec
 * change; letting a desktop user narrow their own nav is not.
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
   * `/chat`'s modules face (`nav-face.tsx`): the Chat row slides the channel
   * list back instead of linking to the open route, and trails what the column
   * gives it (the unread dot and a chevron).
   */
  chatRow?: { onSelect: () => void; trailing: ReactNode };
  className?: string;
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
            current={currentFor(item, pathname)}
            permissions={permissions}
            iconClassName={navIconClassName}
            onNavigate={onNavigate}
            focusClassName={FOCUS_RING_SHELL}
            isModuleEnabled={isModuleEnabled}
            hiddenFeatures={hiddenFeatures}
            collapsed={isCollapsed}
            {...(chatRow && item.id === "chat"
              ? { onSelect: chatRow.onSelect, trailing: chatRow.trailing }
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
