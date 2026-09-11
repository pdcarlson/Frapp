"use client";

import Link from "next/link";
import { can, canAny } from "@repo/validation";
import { cn } from "@/lib/utils";
import type { NavItem } from "@/components/layout/nav-config";

type Props = {
  item: NavItem;
  isActive: boolean;
  permissions: readonly string[] | null | undefined;
  iconClassName: string;
  onNavigate?: () => void;
  /**
   * Rail mode: render the glyph alone, centered, with the label carried by
   * `aria-label` and the native tooltip instead of by visible text.
   */
  collapsed?: boolean;
  focusClassName: string;
  /**
   * Predicate from `useOrgConfig().data?.isModuleEnabled`. When provided and
   * the item declares a `module`, the item is hidden if that module is
   * disabled. Omitted (e.g. while the chapter config is still loading) means
   * "don't module-gate" so items never flash out during the initial load.
   */
  isModuleEnabled?: (moduleKey: string) => boolean;
};

function isGranted(
  item: NavItem,
  permissions: readonly string[] | null | undefined,
): boolean {
  if (item.requirePermission) {
    return can(item.requirePermission, permissions);
  }
  if (item.requireAnyOf) {
    return canAny(item.requireAnyOf, permissions);
  }
  return true;
}

/**
 * The single gate both a nav item and its enclosing section read.
 *
 * `ProtectedNavItem` returns `null` for a hidden item, which tells the parent
 * nothing — so a section whose every item was hidden used to render a bare
 * heading over empty space. The Admin section makes that load-bearing: it is
 * role-gated purely by its items' permissions, and an ordinary member must see
 * neither the rows nor the word "Admin". Exported so `dashboard-shell.tsx` can
 * ask the same question before it draws the heading.
 *
 * Both gates are deliberately fail-open while their source is unresolved:
 * `permissions` is undefined until the query settles, and `isModuleEnabled` is
 * undefined until the chapter config loads. Showing a link one render early is
 * harmless — the route itself is guarded server-side — whereas hiding one is a
 * visible flash of nav items disappearing. (`<Can>` fails closed instead,
 * because it guards actions rather than signposts.)
 */
export function isNavItemVisible(
  item: NavItem,
  permissions: readonly string[] | null | undefined,
  isModuleEnabled?: (moduleKey: string) => boolean,
): boolean {
  if (permissions !== undefined && permissions !== null && !isGranted(item, permissions)) {
    return false;
  }
  if (item.module && isModuleEnabled && !isModuleEnabled(item.module)) {
    return false;
  }
  return true;
}

/**
 * Dashboard sidebar entry that hides itself when the caller lacks the
 * item's required permissions. Items that are not yet wired to a route
 * render as disabled with a small "Soon" chip to preserve roadmap
 * visibility without offering dead-end clicks.
 *
 * Permission checks fall back to the plain "always show" behavior while
 * the permissions query is loading — UI hides only when the fetch has
 * resolved and the caller definitively lacks access. This avoids a flash
 * of nav options during the initial load. Module gating (Chunk 06) layers
 * on top: an item tied to a disabled module is hidden once the chapter
 * config has loaded.
 */
export function ProtectedNavItem({
  item,
  isActive,
  permissions,
  iconClassName,
  onNavigate,
  focusClassName,
  isModuleEnabled,
  collapsed = false,
}: Props) {
  if (!isNavItemVisible(item, permissions, isModuleEnabled)) {
    return null;
  }

  /*
   * Greenfield nav row (board option `1b`, pin 2): 34px tall, radius 10, 10px
   * padding and gap, an 18px duotone glyph and a 14px label.
   *
   * Active is a tinted fill plus accent text and a weight bump — deliberately
   * NOT a left accent bar. The board offers that bar only as a "spice" option
   * (`4f` A) and prices it at 56px of nav height; the baseline shell does not
   * take it.
   *
   * The active pair (`accent-subtle` + `accent-text`) is chapter accent engine
   * output, which guarantees AA contrast at generation time for every seed.
   * That is what replaced the legacy branded `--side-*` sidebar and its
   * stock-text-on-branded-surface failures (#1150/#1164). Hover skips to
   * `--card`, the board's own hover step.
   */
  if (item.href) {
    return (
      <Link
        href={item.href}
        onClick={onNavigate}
        aria-current={isActive ? "page" : undefined}
        // In the rail the label has nowhere to render, so the accessible name
        // has to come from somewhere other than the text content.
        aria-label={collapsed ? item.label : undefined}
        title={collapsed ? item.label : item.description}
        className={cn(
          /*
           * 34px is the board's POINTER geometry. The drawer that renders this
           * below `lg` is touch-only, and `--touch-min` (44px) is binding on
           * web as well as mobile (foundations §9) - so the row is 44px until
           * the desktop breakpoint, then takes the board's density.
           */
          "flex min-h-touch items-center rounded-[10px] text-left text-sm transition lg:h-[34px] lg:min-h-0",
          collapsed
            ? "w-[34px] justify-center"
            : "w-full gap-2.5 px-2.5",
          focusClassName,
          isActive
            ? "bg-accent-subtle font-semibold text-accent-text"
            : "text-muted-foreground hover:bg-card hover:text-foreground",
        )}
      >
        <item.icon className={iconClassName} active={isActive} />
        {collapsed ? null : <span className="truncate">{item.label}</span>}
      </Link>
    );
  }

  return (
    <button
      type="button"
      aria-disabled="true"
      tabIndex={-1}
      aria-label={collapsed ? item.label : undefined}
      title={
        collapsed
          ? item.label
          : (item.description ?? item.statusLabel ?? "Coming soon")
      }
      onClick={(e) => e.preventDefault()}
      className={cn(
        "flex min-h-touch cursor-not-allowed items-center rounded-[10px] text-left text-sm text-disabled lg:h-[34px] lg:min-h-0",
        collapsed ? "w-[34px] justify-center" : "w-full gap-2.5 px-2.5",
        focusClassName,
      )}
    >
      <item.icon className={iconClassName} />
      {collapsed ? null : <span className="truncate">{item.label}</span>}
      {!collapsed && item.statusLabel ? (
        <span className="ml-auto rounded-xs border border-border px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted">
          {item.statusLabel}
        </span>
      ) : null}
    </button>
  );
}
