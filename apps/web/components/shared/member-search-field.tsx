"use client";

import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Command as CommandPrimitive } from "cmdk";
import { Command, CommandItem, CommandList } from "@/components/ui/command";
import { INPUT_CLASSES } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";

/**
 * The "Add a member" field of an editor that collects people (#5738): a
 * search field whose list opens as soon as it is clicked or focused, showing
 * everyone who can be added, and narrows as you type. Picking a row adds them
 * and keeps the list open on a cleared search, so a whole class or group goes
 * in without reopening it. Arrow keys move through the list and Enter adds;
 * Escape clears a search, then closes the list. Comparable: Linear's assignee
 * picker and Notion's person property.
 *
 * The search matches anywhere in a name, as it did before the list opened on
 * click. Unlike `SearchablePicker` (a button whose popover holds its own
 * search and closes on a pick), the field on the page is the search and the
 * list hangs from it. The field is cmdk's own input, drawn as the
 * `Input` primitive, so it carries the combobox roles a screen reader needs.
 * cmdk names that input from its own label and sets its own id, so the field
 * draws its visible label too, and a `<Label htmlFor>` outside can't reach it.
 */
export function MemberSearchField<T>({
  label,
  items,
  nameOf,
  keyOf,
  detailOf,
  onAdd,
  emptyText,
  disabled = false,
  placeholder = "Search by name",
}: {
  /** The field's label, drawn above it: "Add a member". */
  label: string;
  /** Everyone who can be added, in the order they are listed. */
  items: readonly T[];
  /** What the search matches against, and the row's name. */
  nameOf: (item: T) => string;
  keyOf: (item: T) => string;
  /** A muted line under the name, such as where the member moves from. */
  detailOf?: (item: T) => ReactNode;
  onAdd: (item: T) => void;
  /** Said when nobody is left to add and no search is typed. */
  emptyText: string;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  // Anywhere in the name, as the app's other member searches match
  // (attendance), so "son" finds Johnson.
  const needle = query.trim().toLowerCase();
  const searching = needle.length > 0;
  const shown = searching
    ? items.filter((item) => nameOf(item).toLowerCase().includes(needle))
    : items;

  /** Escape clears a search first, then closes; it never reaches the panel. */
  function handleEscape() {
    if (query) setQuery("");
    else setOpen(false);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      handleEscape();
    } else if (
      !open &&
      (event.key === "ArrowDown" || event.key === "ArrowUp")
    ) {
      // Typing opens it through `onValueChange`; the arrows reopen a list
      // Escape closed. Nothing else does, so a closed list stays closed.
      setOpen(true);
    }
  }

  return (
    <Command
      shouldFilter={false}
      label={label}
      className="grid h-auto gap-1 overflow-visible bg-transparent"
    >
      {/* What a screen reader hears is cmdk's own label, from `label`. */}
      <Label aria-hidden onClick={() => inputRef.current?.focus()}>
        {label}
      </Label>
      <Popover open={open && !disabled} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <CommandPrimitive.Input
            ref={inputRef}
            value={query}
            onValueChange={(next) => {
              setQuery(next);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onClick={() => setOpen(true)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            autoComplete="off"
            disabled={disabled}
            className={INPUT_CLASSES}
          />
        </PopoverAnchor>
        <PopoverContent
          align="start"
          className="w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-2rem)] p-0"
          // Focus stays in the field, so typing keeps narrowing the list.
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          // A press on a row would otherwise take focus from the field.
          onMouseDown={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => {
            event.preventDefault();
            handleEscape();
          }}
          onInteractOutside={(event) => {
            // The field is the anchor, not inside the list: a click on it
            // keeps the list open rather than closing and reopening it.
            const target = event.target as Node | null;
            if (target && inputRef.current?.contains(target)) {
              event.preventDefault();
            }
          }}
        >
          <CommandList className="max-h-72 p-1">
            {shown.length === 0 ? (
              <p role="status" className="px-2 py-3 text-sm text-muted">
                {searching ? `Nothing matches “${query.trim()}”.` : emptyText}
              </p>
            ) : (
              shown.map((item) => {
                const detail = detailOf?.(item);
                return (
                  <CommandItem
                    key={keyOf(item)}
                    value={keyOf(item)}
                    className="min-h-9 text-sm"
                    onSelect={() => {
                      onAdd(item);
                      setQuery("");
                    }}
                  >
                    <div className="min-w-0">
                      <p className="truncate">{nameOf(item)}</p>
                      {detail ? (
                        <p className="text-caption text-muted-foreground">
                          {detail}
                        </p>
                      ) : null}
                    </div>
                  </CommandItem>
                );
              })
            )}
          </CommandList>
        </PopoverContent>
      </Popover>
    </Command>
  );
}
