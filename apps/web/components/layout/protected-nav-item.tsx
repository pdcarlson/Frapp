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
  statusIconClassName?: string;
  onNavigate?: () => void;
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
}: Props) {
  if (!isNavItemVisible(item, permissions, isModuleEnabled)) {
    return null;
  }

  // Signet sidebar item (components.md §7): 40px tall, radius 10, tinted
  // accent fill + accent text when active, quiet neutral otherwise. The active
  // pair (`accent-subtle` + `accent-text`) comes from the chapter accent
  // engine, which guarantees their AA contrast at generation time for every
  // seed — this is what replaced the legacy branded `--side-*` sidebar and its
  // stock-text-on-branded-surface failures (#1150/#1164).
  if (item.href) {
    return (
      <Link
        href={item.href}
        onClick={onNavigate}
        aria-current={isActive ? "page" : undefined}
        title={item.description}
        className={cn(
          "flex h-10 w-full items-center gap-2.5 rounded-sm px-3 text-left text-[14.5px] transition",
          focusClassName,
          isActive
            ? "bg-accent-subtle font-semibold text-accent-text"
            : "text-muted-foreground hover:bg-card hover:text-foreground",
        )}
      >
        <item.icon className={iconClassName} active={isActive} />
        <span>{item.label}</span>
      </Link>
    );
  }

  return (
    <button
      type="button"
      aria-disabled="true"
      tabIndex={-1}
      title={item.description ?? item.statusLabel ?? "Coming soon"}
      onClick={(e) => e.preventDefault()}
      className={cn(
        "flex h-10 w-full cursor-not-allowed items-center gap-2.5 rounded-sm px-3 text-left text-[14.5px] text-disabled",
        focusClassName,
      )}
    >
      <item.icon className={iconClassName} />
      <span>{item.label}</span>
      {item.statusLabel ? (
        <span className="ml-auto rounded-xs border border-border px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted">
          {item.statusLabel}
        </span>
      ) : null}
    </button>
  );
}
