"use client";

import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import type { SuggestionKeyDownProps } from "@tiptap/suggestion";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn, initials } from "@/lib/utils";

/** One roster member as offered to the `@`-mention suggestion popup. */
export interface MentionSuggestionItem {
  id: string;
  /**
   * The mention node's serialized text label — the display name with
   * internal whitespace stripped (`composer.tsx`'s `mentionLabelFor`). This
   * is what gets sent, not `displayName`; see that function's comment for why.
   */
  label: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface MentionListHandle {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean;
}

/**
 * The only two fields of `@tiptap/suggestion`'s `SuggestionProps` this popup
 * actually reads. Typed narrowly (rather than the full `SuggestionProps`)
 * so a test can render this component in isolation without stubbing out
 * `editor`/`range`/`query`/`mount`/etc. — fields real only in the mounted,
 * imperatively-rendered production usage in `mention-suggestion.ts`.
 */
export interface MentionListProps {
  items: MentionSuggestionItem[];
  command: (item: MentionSuggestionItem) => void;
}

/**
 * The `@`-mention autocomplete popup. Mounted imperatively by
 * `mentionSuggestion.ts` via `ReactRenderer` — not rendered in the normal
 * React tree — so keyboard handling is exposed through a ref (the tiptap
 * suggestion plugin forwards `onKeyDown` from the editor here) rather than
 * through DOM event listeners on this component.
 *
 * Mirrors `SlashPalette`'s list-with-selection shape, but as a bare anchored
 * dropdown instead of a `Dialog` — a mention is typed inline, so taking over
 * the screen the way the command-launcher palette does would be jarring.
 */
export const MentionList = forwardRef<MentionListHandle, MentionListProps>(
  function MentionList({ items, command }, ref) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  // The item list changes on every keystroke (re-filtered); keep the
  // highlight in bounds rather than pointing at a row that scrolled away.
  useEffect(() => {
    setSelectedIndex(0);
  }, [items]);

  const selectItem = (index: number) => {
    const item = items[index];
    if (item) command(item);
  };

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (items.length === 0) return false;
      if (event.key === "ArrowUp") {
        setSelectedIndex((prev) => (prev + items.length - 1) % items.length);
        return true;
      }
      if (event.key === "ArrowDown") {
        setSelectedIndex((prev) => (prev + 1) % items.length);
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        selectItem(selectedIndex);
        return true;
      }
      return false;
    },
  }));

  if (items.length === 0) {
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
      role="listbox"
      aria-label="Matching members"
      className="max-h-64 w-64 overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
    >
      {items.map((item, index) => (
        <button
          key={item.id}
          type="button"
          role="option"
          aria-selected={index === selectedIndex}
          className={cn(
            "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[13px]",
            index === selectedIndex
              ? "bg-accent-subtle text-accent-text"
              : "hover:bg-surface-2",
          )}
          onMouseEnter={() => setSelectedIndex(index)}
          onClick={() => selectItem(index)}
        >
          <Avatar className="h-6 w-6 shrink-0" aria-hidden="true">
            {item.avatarUrl ? <AvatarImage src={item.avatarUrl} alt="" /> : null}
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
