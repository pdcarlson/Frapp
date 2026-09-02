"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { SuggestionKeyDownProps } from "@tiptap/suggestion";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn, initials } from "@/lib/utils";

/** One roster member as offered to the `@`-mention suggestion popup. */
export interface MentionSuggestionItem {
  id: string;
  /**
   * The mention node's serialized text label — the display name reduced to
   * letters, digits, and marks (`mention-suggestion.ts`'s `mentionLabelFor`).
   * This is what gets sent, not `displayName`; see that function's comment
   * for why.
   */
  label: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface MentionListHandle {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean;
}

/**
 * The fields of `@tiptap/suggestion`'s `SuggestionProps` this popup actually
 * reads. Typed narrowly (rather than the full `SuggestionProps`) so a test
 * can render this component in isolation without stubbing out
 * `editor`/`range`/`query`/`mount`/etc. — fields real only in the mounted,
 * imperatively-rendered production usage in `mention-suggestion.ts`.
 */
export interface MentionListProps {
  items: MentionSuggestionItem[];
  command: (item: MentionSuggestionItem) => void;
  /**
   * True for the plugin's own intermediate dispatch that precedes every real
   * one — `@tiptap/suggestion` always fires `{ items: [], loading: true }`
   * first (unless `minQueryLength`/`initialItems` are configured, which this
   * popup doesn't) and only reports the real, filtered `items` a tick later.
   * Without this the popup would flash "No matching members." on every
   * keystroke, even mid-query with real matches on screen a moment before.
   */
  loading?: boolean;
}

/**
 * The `@`-mention autocomplete popup. Mounted imperatively by
 * `mention-suggestion.ts` via `ReactRenderer` — not rendered in the normal
 * React tree — so keyboard handling is exposed through a ref (the tiptap
 * suggestion plugin forwards `onKeyDown` from the editor here) rather than
 * through DOM event listeners on this component.
 *
 * Mirrors `SlashPalette`'s list-with-selection shape, but as a bare anchored
 * dropdown instead of a `Dialog` — a mention is typed inline, so taking over
 * the screen the way the command-launcher palette does would be jarring.
 */
export const MentionList = forwardRef<MentionListHandle, MentionListProps>(
  function MentionList({ items, command, loading }, ref) {
    // Stale-while-revalidate: hold the last real (non-loading) result set
    // and keep showing it through the plugin's built-in loading dispatch,
    // rather than clearing to empty and back on every keystroke — see the
    // `loading` doc comment above.
    const lastItemsRef = useRef<MentionSuggestionItem[]>(items);
    if (!loading) {
      lastItemsRef.current = items;
    }
    const displayItems = loading ? lastItemsRef.current : items;

    const [selectedIndex, setSelectedIndex] = useState(0);

    // The item list changes on every keystroke (re-filtered); keep the
    // highlight in bounds rather than pointing at a row that scrolled away.
    useEffect(() => {
      setSelectedIndex(0);
    }, [displayItems]);

    const listRef = useRef<HTMLDivElement>(null);

    // Clamped synchronously, not just by the effect above: the effect only
    // fires *after* a render where `displayItems` has already shrunk, so a
    // keydown arriving in that one-render window would otherwise read past
    // the end of the new array. Cheap to just clamp on every render instead
    // of trusting the effect to always win the race.
    const clampedIndex = Math.min(selectedIndex, displayItems.length - 1);

    // Keyboard nav moves `clampedIndex` without any pointer involvement, so
    // nothing else scrolls the row into view — without this, arrowing past
    // the ~5 rows the `max-h-64` container shows at once leaves the
    // highlighted option invisible while Enter/Tab still act on it.
    useEffect(() => {
      listRef.current
        ?.querySelector('[role="option"][aria-selected="true"]')
        ?.scrollIntoView({ block: "nearest" });
    }, [clampedIndex]);

    const selectItem = (index: number) => {
      const item = displayItems[index];
      if (item) command(item);
    };

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }) => {
        if (displayItems.length === 0) return false;
        if (event.key === "ArrowUp") {
          setSelectedIndex(
            (clampedIndex + displayItems.length - 1) % displayItems.length,
          );
          return true;
        }
        if (event.key === "ArrowDown") {
          setSelectedIndex((clampedIndex + 1) % displayItems.length);
          return true;
        }
        if (event.key === "Enter" || event.key === "Tab") {
          selectItem(clampedIndex);
          return true;
        }
        return false;
      },
    }));

    if (displayItems.length === 0) {
      return (
        <div
          role="listbox"
          aria-label="Matching members"
          className="w-64 rounded-md border border-border bg-popover p-2 text-[12.5px] text-muted-foreground shadow-md"
        >
          No matching members.
        </div>
      );
    }

    return (
      <div
        ref={listRef}
        role="listbox"
        aria-label="Matching members"
        className="max-h-64 w-64 overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
      >
        {displayItems.map((item, index) => (
          <button
            key={item.id}
            type="button"
            role="option"
            aria-selected={index === clampedIndex}
            className={cn(
              "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[13px]",
              index === clampedIndex
                ? "bg-accent-subtle text-accent-text"
                : "hover:bg-surface-2",
            )}
            onMouseEnter={() => setSelectedIndex(index)}
            onClick={() => selectItem(index)}
          >
            <Avatar className="h-6 w-6 shrink-0" aria-hidden="true">
              {item.avatarUrl ? (
                <AvatarImage src={item.avatarUrl} alt="" />
              ) : null}
              <AvatarFallback className="text-[10px]">
                {initials(item.displayName)}
              </AvatarFallback>
            </Avatar>
            <span className="truncate">{item.displayName}</span>
          </button>
        ))}
      </div>
    );
  },
);
