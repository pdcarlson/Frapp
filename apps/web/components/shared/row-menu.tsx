"use client";

import {
  useState,
  type ComponentType,
  type ReactElement,
  type ReactNode,
} from "react";
import Link from "next/link";
import { Loader2, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { compactControlClassName } from "@/components/shared/table-controls";
import { cn } from "@/lib/utils";

/**
 * One list of row actions, reachable three ways: right-click (or a touch
 * long-press, or the keyboard's menu key) on the row, and the ⋯ button the
 * row shows on hover and focus.
 *
 * The rules this exists to hold, from the backwork redesign (2026-11-05):
 *
 * 1. **Never right-click only.** The ⋯ button reads the same `entries`, so
 *    anything in the right-click menu is also a visible click away.
 * 2. **One list per kind of row.** Both menus render the same array, so they
 *    cannot drift apart.
 * 3. **The browser keeps its own menu where people expect it.** Right-clicking
 *    selected text, a link, or a text field inside the row opens the normal
 *    browser menu, so copy, paste and "open in new tab" still work.
 */

/**
 * An item's glyph: a Lucide icon, or one of Frapp's own glyphs (a pin that is
 * solid while pinned) wrapped to the same shape.
 */
export type RowMenuIcon = ComponentType<{
  "aria-hidden"?: boolean | "true" | "false";
  className?: string;
}>;

export type RowMenuEntry =
  | ({
      type: "item";
      key: string;
      label: string;
      icon?: RowMenuIcon;
      destructive?: boolean;
      disabled?: boolean;
      /** Id of the text explaining why the item is disabled. */
      describedBy?: string;
      /** Why the item is disabled, when no text on the page says it (offline). */
      title?: string;
    } & (
      | { onSelect: () => void; href?: never; external?: never }
      | {
          /**
           * The item is a link: middle-click, "open in new tab" and the
           * status bar work as they do on any link. `undefined` only while
           * the address is still loading, alongside `disabled`.
           */
          href: string | undefined;
          /** Opens in a new tab, for a page outside Frapp. */
          external?: boolean;
          onSelect?: never;
        }
    ))
  | { type: "separator"; key: string }
  | { type: "label"; key: string; label: string };

const DESTRUCTIVE_ITEM_CLASS =
  "text-destructive-text focus:bg-destructive-tint focus:text-destructive-text";

/** Where a right-click should fall through to the browser's own menu. */
export function keepsBrowserMenu(
  target: EventTarget | null,
  row: Element,
): boolean {
  if (
    target instanceof Element &&
    target.closest("a[href], input, textarea, select, [contenteditable='true']")
  ) {
    return true;
  }
  const selection =
    typeof window === "undefined" ? null : window.getSelection();
  if (
    !selection ||
    selection.isCollapsed ||
    selection.toString().trim() === ""
  ) {
    return false;
  }
  return (
    (selection.anchorNode != null && row.contains(selection.anchorNode)) ||
    (selection.focusNode != null && row.contains(selection.focusNode))
  );
}

function Entries({
  entries,
  kind,
}: {
  entries: readonly RowMenuEntry[];
  kind: "context" | "dropdown";
}) {
  const Item = kind === "context" ? ContextMenuItem : DropdownMenuItem;
  const Separator =
    kind === "context" ? ContextMenuSeparator : DropdownMenuSeparator;
  const Label = kind === "context" ? ContextMenuLabel : DropdownMenuLabel;
  return (
    <>
      {entries.map((entry) => {
        if (entry.type === "separator") return <Separator key={entry.key} />;
        if (entry.type === "label") {
          return <Label key={entry.key}>{entry.label}</Label>;
        }
        const Icon = entry.icon;
        const body = (
          <>
            {Icon ? <Icon aria-hidden="true" /> : null}
            {entry.label}
          </>
        );
        const itemProps = {
          disabled: entry.disabled,
          "aria-describedby": entry.describedBy,
          title: entry.title,
          className: entry.destructive ? DESTRUCTIVE_ITEM_CLASS : undefined,
        };
        if (entry.onSelect) {
          return (
            <Item key={entry.key} {...itemProps} onSelect={entry.onSelect}>
              {body}
            </Item>
          );
        }
        return (
          <Item key={entry.key} {...itemProps} asChild>
            {entry.external ? (
              <a href={entry.href} target="_blank" rel="noopener noreferrer">
                {body}
              </a>
            ) : entry.href?.startsWith("/") ? (
              <Link href={entry.href}>{body}</Link>
            ) : (
              // Another scheme the browser hands to an app (`webcal:`).
              <a href={entry.href}>{body}</a>
            )}
          </Item>
        );
      })}
    </>
  );
}

/**
 * Wraps a row element. `children` receives the ⋯ button to place inside the
 * row, and must return a single element that accepts a ref and event props
 * (an `<li>` or `<div>`). Give the row `group` so the button can appear on
 * hover; the button is always visible on touch screens.
 */
export function RowMenu({
  entries,
  label,
  children,
}: {
  entries: readonly RowMenuEntry[];
  /** Accessible name for the ⋯ button, e.g. "More for Cog Sci Homework 2". */
  label: string;
  children: (menuButton: ReactNode) => ReactElement;
}) {
  // Decided on every pointerdown, which React flushes before the browser fires
  // `contextmenu`, so a disabled trigger leaves that event to the browser
  // instead of opening this menu. The verdict lasts for that one event and is
  // cleared as it passes: Radix skips its long-press timer while the trigger is
  // disabled, so a verdict left standing would swallow the next long-press.
  const [browserMenu, setBrowserMenu] = useState(false);
  const button = <MoreButton entries={entries} label={label} onRow />;

  return (
    <ContextMenu>
      <ContextMenuTrigger
        asChild
        disabled={browserMenu}
        onPointerDown={(event) => {
          // The right button, or a Mac's Ctrl+click, opens a context menu
          // with the mouse. A touch long-press does not get the browser
          // menu: the row menu is the only one touch can reach.
          const opensMenu =
            event.pointerType !== "touch" &&
            (event.button === 2 || (event.button === 0 && event.ctrlKey));
          setBrowserMenu(
            opensMenu && keepsBrowserMenu(event.target, event.currentTarget),
          );
        }}
        onContextMenu={() => {
          if (browserMenu) setBrowserMenu(false);
        }}
        onKeyDown={(event) => {
          // The menu key and Shift+F10 fire `contextmenu` with no pointerdown
          // first, so a verdict left over from the last right-click must not
          // decide them.
          if (
            event.key === "ContextMenu" ||
            (event.shiftKey && event.key === "F10")
          ) {
            setBrowserMenu(false);
          }
        }}
      >
        {children(button)}
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-[220px]">
        <Entries entries={entries} kind="context" />
      </ContextMenuContent>
    </ContextMenu>
  );
}

/**
 * The ⋯ button and its menu. On a row it hides until the row is hovered or
 * focused (never on touch); in a page or record header it always shows.
 */
function MoreButton({
  entries,
  label,
  onRow = false,
  disabled = false,
  busy = false,
  onOpenChange,
}: {
  entries: readonly RowMenuEntry[];
  label: string;
  onRow?: boolean;
  disabled?: boolean;
  busy?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        onOpenChange?.(next);
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={disabled || busy}
          aria-busy={busy || undefined}
          aria-label={label}
          title="More"
          className={cn(
            compactControlClassName,
            "shrink-0",
            // Out of the way until the row is hovered or focused; never hidden
            // from touch, where there is no hover.
            onRow &&
              "opacity-0 focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100 pointer-coarse:opacity-100",
          )}
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="min-w-[220px]"
        // The content is portaled, but React still bubbles its events up the
        // component tree to a row's context-menu trigger: without this, a
        // right-click or a long-press on an open ⋯ menu would open the row's
        // menu on top of it.
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <Entries entries={entries} kind="dropdown" />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The ⋯ in a page, panel or record header: the same entries and menu as a
 * row's, always visible. Every "more actions" button on web is this or
 * `RowMenu` (rulebook § 9, `spec/ui/design-system/components.md` § Action
 * menu); lint flags a hand-built ⋯ anywhere else.
 */
export function ActionMenuButton({
  entries,
  label,
  disabled,
  busy,
  onOpenChange,
}: {
  entries: readonly RowMenuEntry[];
  /** Accessible name, e.g. "More for Chapter Meeting". */
  label: string;
  /** Nothing in the menu can run now (the card is mid-save). */
  disabled?: boolean;
  /** An action from the menu is running: a spinner in place of the ⋯. */
  busy?: boolean;
  /** Told when the menu opens, e.g. to fetch what its items need. */
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <MoreButton
      entries={entries}
      label={label}
      disabled={disabled}
      busy={busy}
      onOpenChange={onOpenChange}
    />
  );
}
