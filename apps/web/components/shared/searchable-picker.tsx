"use client";

import { useRef, useState, type ReactElement, type ReactNode } from "react";
import { matchesWordStarts, normalizeWords } from "@repo/hooks/fuzzy-match";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

/** A heading over some of the shown items, in the order given. */
type PickerGroup<T> = { heading: string; items: readonly T[] };

/**
 * A button that opens a filterable list to pick one item from (#4608): the
 * "Add" under a module page's "Who can", and Goals' "Different goal for a
 * role". Filterable because a chapter imported from Discord can carry a
 * hundred roles. The search matches the start of any word in an item's name
 * (`matchesWordStarts`), Escape clears a search before it closes the list,
 * and picking closes it.
 *
 * Each caller brings its own trigger, words, item key and item content, and
 * may sort the shown items under headings; empty headings are left out.
 * Channel and document access's "Add" (#5264) and a long filter chip's list
 * draw it too, which is what the optional props below are for: each one's
 * default is the picker as "Who can" and Goals draw it.
 */
export function SearchablePicker<T>({
  trigger,
  align,
  label,
  placeholder,
  items,
  nameOf,
  keyOf,
  groupsOf,
  itemClassName,
  renderItem,
  onPick,
  widthClassName = "min-w-[14rem] max-w-[min(22rem,calc(100vw-2rem))]",
  status,
  emptyText,
  leadingItems = [],
  defaultValue,
  keyboardlessOnTouch = false,
}: {
  /** The button that opens the list; it becomes the popover's trigger. */
  trigger: ReactElement;
  align: "start" | "end";
  /** The list's accessible name. */
  label: string;
  placeholder: string;
  items: readonly T[];
  /** What the search matches against. */
  nameOf: (item: T) => string;
  /** The item's React key and cmdk value. */
  keyOf: (item: T) => string;
  /** Headings over the shown items; without it the list is flat. */
  groupsOf?: (shown: readonly T[]) => readonly PickerGroup<T>[];
  /** Each item row's classes. */
  itemClassName: string;
  /** What each item shows inside its row. */
  renderItem: (item: T) => ReactNode;
  onPick: (item: T) => void;
  /** The list's min and max width; it is otherwise as wide as its widest row. */
  widthClassName?: string;
  /** Said in place of the list while there is nothing to pick from yet. */
  status?: ReactNode;
  /** Said when there are no items at all and no search is typed. */
  emptyText?: string;
  /**
   * Rows that lead the list and step aside while a search is typed: an "Any"
   * row isn't something to search for, and as the first match it would be
   * the row Enter picks.
   */
  leadingItems?: readonly T[];
  /** The row cmdk opens highlighted and scrolled into view. */
  defaultValue?: string;
  /**
   * On touch, open without the on-screen keyboard so the list can be
   * scrolled; a tap on the field brings it up. Focus still moves into the
   * list, so a hardware keyboard's arrows and Enter work.
   */
  keyboardlessOnTouch?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const commandRef = useRef<HTMLDivElement>(null);
  const searching = normalizeWords(query).length > 0;
  const shown = searching
    ? items.filter((item) => matchesWordStarts(nameOf(item), query))
    : [...leadingItems, ...items];
  const close = () => {
    setOpen(false);
    setQuery("");
  };
  const row = (item: T) => (
    <CommandItem
      key={keyOf(item)}
      value={keyOf(item)}
      className={itemClassName}
      onSelect={() => {
        onPick(item);
        close();
      }}
    >
      {renderItem(item)}
    </CommandItem>
  );

  return (
    <Popover
      open={open}
      onOpenChange={(next) => (next ? setOpen(true) : close())}
    >
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align={align}
        className={`w-max ${widthClassName} p-0`}
        onOpenAutoFocus={(event) => {
          if (
            keyboardlessOnTouch &&
            window.matchMedia?.("(pointer: coarse)").matches
          ) {
            event.preventDefault();
            commandRef.current?.focus();
          }
        }}
        onEscapeKeyDown={(event) => {
          if (!query) return;
          event.preventDefault();
          setQuery("");
        }}
      >
        <Command
          ref={commandRef}
          tabIndex={-1}
          className="outline-none"
          shouldFilter={false}
          defaultValue={defaultValue}
          label={label}
        >
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder={placeholder}
            className="h-9 py-2 text-sm pointer-coarse:h-11 pointer-coarse:text-base"
          />
          <CommandList className="max-h-72 p-1">
            {status !== undefined ? (
              <p role="status" className="px-2 py-3 text-sm text-muted">
                {status}
              </p>
            ) : shown.length === 0 ? (
              <p role="status" className="px-2 py-3 text-sm text-muted">
                {!searching && emptyText !== undefined
                  ? emptyText
                  : `Nothing matches “${query.trim()}”.`}
              </p>
            ) : groupsOf ? (
              groupsOf(shown)
                .filter((group) => group.items.length > 0)
                .map((group) => (
                  <CommandGroup key={group.heading} heading={group.heading}>
                    {group.items.map(row)}
                  </CommandGroup>
                ))
            ) : (
              shown.map(row)
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
