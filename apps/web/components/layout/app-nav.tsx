"use client";

import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { ChapterNavHeader } from "@/components/layout/chapter-nav-header";
import { DASHBOARD_NAV } from "@/components/layout/nav-config";
import {
  isNavItemVisible,
  ProtectedNavItem,
} from "@/components/layout/protected-nav-item";

/**
 * The flush-left navigation column: 220px expanded, 56px as an icon rail.
 *
 * Geometry is board option `1b` (expanded) and `1c` (rail). `--surface-1` field,
 * one hairline on the right, 8px of padding, 2px between rows.
 *
 * **Collapsing is a preference, not a breakpoint.** The responsive contract is
 * still two states switching once at `lg` (`spec/ui/web-dashboard/README.md`):
 * below `lg` this component renders inside the mobile drawer, always expanded,
 * and the rail never appears there. Adding a viewport tier would be a spec
 * change; letting a desktop user narrow their own nav is not.
 *
 * Section headings are derived, never declared — a heading renders only when at
 * least one of its items survives both the permission and module gates, so the
 * Admin group takes its heading with it for an ordinary member. In the rail
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
   * The drawer reuses this component wholesale rather than duplicating the nav
   * ("the drawer is the sidebar"). It supplies its own heading and scroll
   * container, so it suppresses the collapse toggle and the outer chrome.
   */
  variant?: "sidebar" | "drawer";
  className?: string;
};

/*
 * The one focus recipe (board `1d` pin 1): a 3px spread of the ring color at
 * 25%. Kept as the sidebar-local constant it already was rather than switched
 * to the shared `FOCUS_RING`, because that recipe's border swap is unguarded
 * and non-conforming on several chapter seeds (open lock L-07). Unifying the
 * two is that lock's job, not this lane's.
 */
const navFocusRingClassName =
  "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25";

/** 18px duotone glyph, per `1b` pin 2. */
const navIconClassName = "h-[18px] w-[18px]";

export function AppNav({
  collapsed,
  onToggleCollapsed,
  permissions,
  isModuleEnabled,
  pathname,
  onNavigate,
  variant = "sidebar",
  className,
}: AppNavProps) {
  const isDrawer = variant === "drawer";
  // The drawer has no room to be a rail and no toggle to leave it, so it is
  // always expanded regardless of the stored preference.
  const isCollapsed = collapsed && !isDrawer;

  const sections = DASHBOARD_NAV.map((section) => {
    const visibleItems = section.items.filter((item) =>
      isNavItemVisible(item, permissions, isModuleEnabled),
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
          <p className="px-2.5 pb-1 pt-3.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
            {section.label}
          </p>
        )}
        {visibleItems.map((item) => (
          <ProtectedNavItem
            key={item.id}
            item={item}
            isActive={item.href === pathname}
            permissions={permissions}
            iconClassName={navIconClassName}
            onNavigate={onNavigate}
            focusClassName={navFocusRingClassName}
            isModuleEnabled={isModuleEnabled}
            collapsed={isCollapsed}
          />
        ))}
      </div>
    );
  });

  const CollapseIcon = isCollapsed ? PanelLeftOpen : PanelLeftClose;

  return (
    <div
      className={cn(
        "flex min-h-0 flex-col",
        isDrawer
          ? "flex-1"
          : cn(
              "box-border shrink-0 border-r border-border bg-surface-1 p-2",
              isCollapsed ? "w-[56px] items-center" : "w-[220px]",
            ),
        className,
      )}
    >
      <ChapterNavHeader collapsed={isCollapsed} onNavigate={onNavigate} />
      <nav
        aria-label="Primary"
        className={cn(
          "mt-1 flex min-h-0 flex-1 flex-col overflow-y-auto",
          isCollapsed && "items-center",
        )}
      >
        {sections}
      </nav>
      {isDrawer ? null : (
        <div
          className={cn(
            "mt-auto flex pt-2",
            isCollapsed ? "justify-center" : "justify-end",
          )}
        >
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label={isCollapsed ? "Expand navigation" : "Collapse navigation"}
            aria-expanded={!isCollapsed}
            title={isCollapsed ? "Expand navigation" : "Collapse navigation"}
            className={cn(
              "grid h-[34px] w-[34px] place-items-center rounded-[10px] text-muted transition hover:bg-card hover:text-foreground",
              navFocusRingClassName,
            )}
          >
            <CollapseIcon className="h-[18px] w-[18px]" aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}
