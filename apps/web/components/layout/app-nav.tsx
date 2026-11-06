"use client";

import { ChevronRight, PanelLeftClose, PanelLeftOpen } from "lucide-react";
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
 * **On `/chat` it is a face, not the column** (`variant="face"`, 2026-11-05):
 * from `lg` up the left column there is the channel list, and this nav slides
 * in over it from a back arrow (`chat-nav-column.tsx`). The face has no chrome,
 * no collapse toggle and no chapter header, which the column pins above both.
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
   * The drawer reuses this component wholesale rather than duplicating the nav
   * ("the drawer is the sidebar"). It supplies its own heading and scroll
   * container, so it suppresses the collapse toggle and the outer chrome.
   */
  variant?: "sidebar" | "drawer" | "face";
  /**
   * The module face of `/chat`'s left column (`nav-face.tsx`): the Chat row
   * slides the channel list back instead of linking to the open route, and
   * carries an unread dot while the channels are out of sight.
   */
  chatRow?: { onSelect: () => void; hasUnread: boolean };
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
  variant = "sidebar",
  chatRow,
  className,
}: AppNavProps) {
  // The face shares the drawer's shape: no outer chrome and no collapse
  // toggle. It also leaves the chapter header out, because the column it sits
  // in keeps that header pinned above both faces.
  const isFace = variant === "face";
  const isDrawer = variant === "drawer" || isFace;
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
              ? {
                  onSelect: chatRow.onSelect,
                  trailing: (
                    <>
                      {chatRow.hasUnread ? (
                        <>
                          <span
                            aria-hidden="true"
                            className="h-1.5 w-1.5 rounded-full bg-foreground"
                          />
                          <span className="sr-only">, unread messages</span>
                        </>
                      ) : null}
                      <ChevronRight
                        className="h-3.5 w-3.5 text-muted"
                        aria-hidden="true"
                      />
                    </>
                  ),
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
      {isFace ? null : (
        <ChapterNavHeader collapsed={isCollapsed} onNavigate={onNavigate} />
      )}
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
