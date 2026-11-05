"use client";

import { useState, type ReactElement, type ReactNode } from "react";
import { MoreHorizontal, type LucideIcon } from "lucide-react";
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

export type RowMenuEntry =
  | {
      type: "item";
      key: string;
      label: string;
      icon?: LucideIcon;
      onSelect: () => void;
      destructive?: boolean;
      disabled?: boolean;
    }
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
  if (!selection || selection.isCollapsed || selection.toString().trim() === "") {
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
        return (
          <Item
            key={entry.key}
            disabled={entry.disabled}
            onSelect={entry.onSelect}
            className={entry.destructive ? DESTRUCTIVE_ITEM_CLASS : undefined}
          >
            {Icon ? <Icon aria-hidden="true" /> : null}
            {entry.label}
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
  // instead of opening this menu. Every press decides afresh, so a verdict from
  // an earlier right-click can never block a later long-press or menu key.
  const [browserMenu, setBrowserMenu] = useState(false);
  const [buttonOpen, setButtonOpen] = useState(false);

  const button = (
    <DropdownMenu open={buttonOpen} onOpenChange={setButtonOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="quiet"
          size="icon"
          aria-label={label}
          title="More"
          className={cn(
            compactControlClassName,
            "shrink-0",
            // Out of the way until the row is hovered or focused; never hidden
            // from touch, where there is no hover.
            "opacity-0 focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100 pointer-coarse:opacity-100",
          )}
        >
          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="min-w-[220px]"
        // The content is portaled, but React still bubbles its events up the
        // component tree to the row's context-menu trigger: without this, a
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
        onKeyDown={(event) => {
          // The menu key and Shift+F10 fire `contextmenu` with no pointerdown
          // first, so a verdict left over from the last right-click must not
          // decide them.
          if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
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
