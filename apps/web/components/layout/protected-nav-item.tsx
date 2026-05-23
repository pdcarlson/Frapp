"use client";

import Link from "next/link";
import { can, canAny } from "@/lib/auth/can";
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
 * Dashboard sidebar entry that hides itself when the caller lacks the
 * item's required permissions. Items that are not yet wired to a route
 * render as disabled with a small "Soon" chip to preserve roadmap
 * visibility without offering dead-end clicks.
 *
 * Permission checks fall back to the plain "always show" behavior while
 * the permissions query is loading — UI hides only when the fetch has
 * resolved and the caller definitively lacks access. This avoids a flash
 * of nav options during the initial load.
 */
export function ProtectedNavItem({
  item,
  isActive,
  permissions,
  iconClassName,
  onNavigate,
  focusClassName,
}: Props) {
  if (permissions !== undefined && permissions !== null && !isGranted(item, permissions)) {
    return null;
  }

  if (item.href) {
    return (
      <Link
        href={item.href}
        onClick={onNavigate}
        aria-current={isActive ? "page" : undefined}
        title={item.description}
        className={cn(
          "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition",
          focusClassName,
          isActive
            ? "border-l-2 border-side-accent bg-side-bg-hi text-side-fg-hi"
            : "border-l-2 border-transparent text-side-fg hover:bg-side-bg-hi/70 hover:text-side-fg-hi",
        )}
      >
        <item.icon className={iconClassName} />
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
        "flex w-full cursor-not-allowed items-center gap-3 rounded-md px-3 py-2 text-left text-sm text-side-muted opacity-60",
        focusClassName,
      )}
    >
      <item.icon className={iconClassName} />
      <span>{item.label}</span>
      {item.statusLabel ? (
        <span className="ml-auto rounded-xs border border-side-divider px-2 py-0.5 text-[10px] uppercase tracking-wide text-side-muted">
          {item.statusLabel}
        </span>
      ) : null}
    </button>
  );
}
