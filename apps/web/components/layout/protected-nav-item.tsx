"use client";

import Link from "next/link";
import { can, canAny } from "@repo/validation";
import type { UnsetFeatureKey } from "@repo/hooks";
import { cn } from "@/lib/utils";
import type { NavItem } from "@/components/layout/nav-config";

type Props = {
  item: NavItem;
  /**
   * `"page"` when this row's own route is open; `"true"` when a route listed in
   * the row's `activeFor` is open (a Settings tool, for the Settings row).
   * Both paint the active fill; only the first claims to be the current page.
   */
  current?: "page" | "true";
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
   * The chapter's module gate, from `useChapterModuleGate()` (the member-
   * readable current chapter; never `useOrgConfig()`, which members cannot
   * read, #1982). When provided and the item declares a `module`, the item
   * hides if that module is off. Omitted while the chapter read is in flight,
   * which means "don't module-gate", so items never flash out during the
   * initial load. Once that read has failed the gate says every module is off.
   */
  isModuleEnabled?: (moduleKey: string) => boolean;
  /** The setup gate, from `useHiddenUnsetFeatures` (see `isNavItemVisible`). */
  hiddenFeatures?: ReadonlySet<UnsetFeatureKey>;
  /**
   * Act in place instead of navigating (#3779): the desktop shell's Chat row
   * opens and closes the chat panel, and the open tool's row closes it. It
   * renders as a toggle button with the same geometry.
   */
  onSelect?: () => void;
  /** With `onSelect`: whether the panel this row toggles is open. */
  pressed?: boolean;
  /** With `onSelect`: what the toggle does, as its tooltip ("Close Events"). */
  selectLabel?: string;
  /**
   * Something new behind this row (#3824), named for a screen reader ("unread
   * messages"). The row draws bright and semibold with a dot, and in the rail
   * the dot sits on the glyph.
   */
  highlight?: string;
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
 * heading over empty space. Exported so `app-nav.tsx` can ask the same
 * question before it draws a section's heading: a heading is a promise that
 * something the viewer can open sits under it.
 *
 * The permission and module gates are deliberately fail-open while their source is unresolved:
 * `permissions` is undefined until the query settles, and `isModuleEnabled` is
 * undefined until the current-chapter read settles. Showing a link one render early is
 * harmless — the route itself is guarded server-side — whereas hiding one is a
 * visible flash of nav items disappearing. (`<Can>` fails closed instead,
 * because it guards actions rather than signposts.)
 *
 * `hiddenFeatures` is the third gate, the setup gate, from
 * `useHiddenUnsetFeatures`: the features nobody has set up that this viewer
 * can't set up from the feature's own page. It hides nothing while
 * permissions or the module gate are unresolved, or while a list's read has
 * no answer; it hides on a list that answers "none", or on that list's module
 * being off.
 */
export function isNavItemVisible(
  item: NavItem,
  permissions: readonly string[] | null | undefined,
  isModuleEnabled?: (moduleKey: string) => boolean,
  hiddenFeatures?: ReadonlySet<UnsetFeatureKey>,
): boolean {
  const resolved = permissions !== undefined && permissions !== null;
  if (resolved && !isGranted(item, permissions)) {
    return false;
  }
  if (item.module && isModuleEnabled && !isModuleEnabled(item.module)) {
    return false;
  }
  if (item.hiddenUntilSetUp && hiddenFeatures?.has(item.hiddenUntilSetUp)) {
    return false;
  }
  if (
    resolved &&
    item.showWhen &&
    !item.showWhen(permissions, isModuleEnabled)
  ) {
    return false;
  }
  return true;
}

/**
 * Dashboard sidebar entry that hides itself when the caller lacks the
 * item's required permissions.
 *
 * Permission checks fall back to the plain "always show" behavior while
 * the permissions query is loading — UI hides only when the fetch has
 * resolved and the caller definitively lacks access. This avoids a flash
 * of nav options during the initial load. Module gating (Chunk 06) layers
 * on top: an item tied to a disabled module is hidden once the current-chapter
 * read has settled.
 */
export function ProtectedNavItem({
  item,
  current,
  permissions,
  iconClassName,
  onNavigate,
  focusClassName,
  isModuleEnabled,
  hiddenFeatures,
  collapsed = false,
  onSelect,
  pressed,
  selectLabel,
  highlight,
}: Props) {
  if (!isNavItemVisible(item, permissions, isModuleEnabled, hiddenFeatures)) {
    return null;
  }
  const isActive = current !== undefined;

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
  const className = cn(
    /*
     * 34px is the board's POINTER geometry. The drawer that renders this
     * below `lg` is touch-only, and `--touch-min` (44px) is binding on
     * web as well as mobile (foundations §9) - so the row is 44px until
     * the desktop breakpoint, then takes the board's density.
     */
    "relative flex min-h-touch items-center rounded-[10px] text-left text-sm transition lg:h-[34px] lg:min-h-0",
    collapsed ? "w-[34px] justify-center" : "w-full gap-2.5 px-2.5",
    focusClassName,
    isActive
      ? "bg-accent-subtle font-semibold text-accent-text"
      : highlight
        ? // Something new (#3824): bright and semibold, the way an unread
          // channel row draws, so it reads lit at a glance and stays lit.
          "font-semibold text-foreground hover:bg-card"
        : "text-muted-foreground hover:bg-card hover:text-foreground",
  );
  // The rail's `aria-label` replaces the row's content, the sr-only words
  // included, so it carries them itself.
  const railLabel = highlight ? `${item.label}, ${highlight}` : item.label;
  const dot = highlight ? (
    <span
      aria-hidden="true"
      data-nav-highlight=""
      className={cn(
        "h-1.5 w-1.5 shrink-0 rounded-full bg-foreground",
        // In the rail there is no label to trail, so the dot sits on the glyph.
        collapsed && "absolute right-1 top-1",
      )}
    />
  ) : null;
  const content = (
    <>
      <item.icon className={iconClassName} active={isActive} />
      {collapsed ? null : <span className="truncate">{item.label}</span>}
      {collapsed ? dot : null}
      {collapsed || !dot ? null : (
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {dot}
        </span>
      )}
      {highlight && !collapsed ? (
        <span className="sr-only">, {highlight}</span>
      ) : null}
    </>
  );

  if (onSelect) {
    return (
      <button
        type="button"
        onClick={onSelect}
        aria-current={current}
        aria-pressed={pressed}
        aria-label={collapsed ? railLabel : undefined}
        title={selectLabel ?? (collapsed ? item.label : item.description)}
        className={className}
      >
        {content}
      </button>
    );
  }

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={current}
      // In the rail the label has nowhere to render, so the accessible name
      // has to come from somewhere other than the text content.
      aria-label={collapsed ? railLabel : undefined}
      title={collapsed ? item.label : item.description}
      className={className}
    >
      {content}
    </Link>
  );
}
