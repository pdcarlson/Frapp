"use client";

import { useMemo, useRef, useState, type ReactElement } from "react";
import { ArrowUpDown, Check, ChevronDown } from "lucide-react";
import { normalizeWords } from "@repo/hooks/fuzzy-match";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * `short` is what the chip reads while this option is set, when the list's
 * label is longer than a chip should be: Backwork's "COGS 2120 · Intro to
 * Cognitive Science" lists whole and reads "COGS 2120" on the chip.
 */
export type FilterOption = { value: string; label: string; short?: string };

/**
 * Past this many options the chip's list gets a type-to-filter field above
 * it (#3970). A status or a sort fits on screen and needs no box; a chapter
 * imported from Discord can carry 100+ roles, and scrolling for one is slow.
 */
export const FILTER_SEARCH_THRESHOLD = 8;

/** The chip's shape, shared with `DateFilterChip` so one toolbar row draws one chip. */
export const FILTER_CHIP_CLASS = "gap-1 rounded-full font-semibold";
const CHIP = FILTER_CHIP_CLASS;
/** A cmdk row drawn at the menu row's size, so both lists read as one menu. */
const SEARCH_ROW =
  "min-h-8 text-sm pointer-coarse:min-h-11 pointer-coarse:text-base";
/** The "any" row's cmdk value; an option's own value can't collide with it. */
const ANY = "\u0000any";

/**
 * A toolbar filter: a round chip that opens a menu of the values some row
 * actually has, applied the moment one is picked. Secondary at rest, tinted
 * while a value is set, and the chip then names the value. First drawn for
 * `/backwork` (rebuilt 2026-11-05); `/documents` (#3852) and the Directory
 * (#3970) use it too.
 *
 * A long list (more than `FILTER_SEARCH_THRESHOLD` options) opens with a
 * type-to-filter field above it. The whole list is still there to scroll;
 * typing narrows it and clearing the field brings it back (Shawn, 2026-11-10).
 */
export function FilterChip({
  label,
  anyLabel,
  options,
  value,
  onChange,
}: {
  label: string;
  anyLabel: string;
  options: readonly FilterOption[];
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  const selected = options.find((option) => option.value === value);
  const active = value !== null;
  const trigger = (
    <Button
      type="button"
      variant={active ? "tinted" : "secondary"}
      size="toolbar"
      className={CHIP}
      aria-label={active ? `${label}: ${selected?.label ?? value}` : label}
      disabled={options.length === 0 && !active}
    >
      <span className="max-w-[160px] truncate">
        {active ? (selected?.short ?? selected?.label ?? value) : label}
      </span>
      <ChevronDown className="h-3.5 w-3.5 opacity-70" aria-hidden="true" />
    </Button>
  );

  if (options.length > FILTER_SEARCH_THRESHOLD) {
    return (
      <SearchableOptions
        trigger={trigger}
        label={label}
        anyLabel={anyLabel}
        options={options}
        value={value}
        onChange={onChange}
      />
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 min-w-[200px]">
        <DropdownMenuItem onSelect={() => onChange(null)}>
          <Check
            className={cn("h-4 w-4", active && "invisible")}
            aria-hidden="true"
          />
          {anyLabel}
        </DropdownMenuItem>
        {options.map((option) => (
          <DropdownMenuItem
            key={option.value}
            onSelect={() => onChange(option.value)}
          >
            <Check
              className={cn("h-4 w-4", option.value !== value && "invisible")}
              aria-hidden="true"
            />
            {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The long-list body: a popover holding a search field over the option list.
 * A popover and cmdk rather than the dropdown menu, because a menu's typeahead
 * takes the keys meant for the field (the reason `DateFilterChip` is one too).
 * cmdk gives the combobox roles, arrow keys and Enter; the match is ours
 * (`matchesWordStarts`).
 */
/**
 * Every word typed must start a word of the label, ignoring case and accents:
 * "vi pre" finds "Vice President". Words split on anything that isn't a letter
 * or digit (`normalizeWords`, the page searches' own splitter), because a role
 * or course label is not a person's name: "exec" must find "(Exec) Treasurer"
 * and "rec" must find "Rush/Recruitment Chair".
 */
export function matchesWordStarts(label: string, query: string): boolean {
  const terms = normalizeWords(query);
  if (!terms.length) return true;
  const words = normalizeWords(label);
  return terms.every((term) => words.some((word) => word.startsWith(term)));
}

function SearchableOptions({
  trigger,
  label,
  anyLabel,
  options,
  value,
  onChange,
}: {
  trigger: ReactElement;
  label: string;
  anyLabel: string;
  options: readonly FilterOption[];
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const commandRef = useRef<HTMLDivElement>(null);
  // The "any" row leads the whole list and steps aside while a query is
  // typed: it is not something to search for, and as the first match it would
  // be the row Enter picks ("co" for a course would clear the filter through
  // "Any course").
  const shown = useMemo(
    () =>
      normalizeWords(query).length === 0
        ? [{ value: ANY, label: anyLabel }, ...options]
        : options.filter((row) => matchesWordStarts(row.label, query)),
    [anyLabel, options, query],
  );
  const current = value ?? ANY;
  const close = () => {
    setOpen(false);
    setQuery("");
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => (next ? setOpen(true) : close())}
    >
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align="start"
        // As wide as its longest label, up to a cap; past that a label wraps
        // rather than being cut, since two long names can share a prefix.
        className="w-max min-w-[15rem] max-w-[min(26rem,calc(100vw-2rem))] p-0"
        // On touch the list opens without the on-screen keyboard, so it can be
        // scrolled; a tap on the field brings the keyboard up. Focus still
        // moves into the list, so arrow keys and Enter work from a hardware
        // keyboard.
        onOpenAutoFocus={(event) => {
          if (window.matchMedia?.("(pointer: coarse)").matches) {
            event.preventDefault();
            commandRef.current?.focus();
          }
        }}
        // Esc clears a typed query first and closes on the second press.
        onEscapeKeyDown={(event) => {
          if (!query) return;
          event.preventDefault();
          setQuery("");
        }}
      >
        {/* Opens with the chosen row highlighted and scrolled into view. */}
        {/* `label` names the field: cmdk points the input at it itself. */}
        <Command
          ref={commandRef}
          tabIndex={-1}
          className="outline-none"
          shouldFilter={false}
          defaultValue={current}
          label={`Filter the ${label} list`}
        >
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder="Type to filter"
            className="h-9 py-2 text-sm pointer-coarse:h-11 pointer-coarse:text-base"
          />
          <CommandList className="max-h-72 p-1">
            {shown.length === 0 ? (
              <p role="status" className="px-2 py-3 text-sm text-muted">
                Nothing matches “{query.trim()}”.
              </p>
            ) : (
              shown.map((row) => (
                <CommandItem
                  key={row.value}
                  value={row.value}
                  className={SEARCH_ROW}
                  onSelect={() => {
                    onChange(row.value === ANY ? null : row.value);
                    close();
                  }}
                >
                  <Check
                    className={cn(
                      "h-4 w-4",
                      row.value !== current && "invisible",
                    )}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1 break-words">
                    {row.label}
                    {row.value === current ? (
                      <span className="sr-only"> (selected)</span>
                    ) : null}
                  </span>
                </CommandItem>
              ))
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/**
 * The order chip. Never tinted: an order is always set, so it isn't a filter.
 * Shared by `/documents` and the Directory.
 */
export function SortChip<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  const selected = options.find((option) => option.value === value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="secondary"
          size="toolbar"
          className={CHIP}
          aria-label={`Sort: ${selected?.label ?? value}`}
        >
          <ArrowUpDown className="h-3.5 w-3.5 opacity-70" aria-hidden="true" />
          <span className="truncate">{selected?.label ?? value}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[180px]">
        {options.map((option) => (
          <DropdownMenuItem
            key={option.value}
            onSelect={() => onChange(option.value)}
          >
            <Check
              className={cn("h-4 w-4", option.value !== value && "invisible")}
              aria-hidden="true"
            />
            {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
