"use client";

import { FOCUS_RING } from "@/components/ui/focus";
import { cn } from "@/lib/utils";
import {
  EmojiPicker as Frimousse,
  type EmojiPickerListCategoryHeaderProps,
  type EmojiPickerListEmojiProps,
  type EmojiPickerListRowProps,
} from "frimousse";

/**
 * Themed wrapper around the `frimousse` emoji picker so calling sites stay
 * declarative (`<EmojiPicker onPick={...} />`) and the keyboard / accessible
 * affordances come from the library.
 */
export function EmojiPicker({
  onPick,
}: {
  onPick: (emoji: string) => void;
}) {
  return (
    <Frimousse.Root
      className="flex h-72 w-72 flex-col rounded-md border border-border bg-popover text-popover-foreground"
      onEmojiSelect={({ emoji }) => onPick(emoji)}
    >
      {/*
        The field is `--surface-1` inside a `--popover` panel and takes the
        shared focus recipe. It used to be `bg-background` — the app floor
        painted two ladder steps *below* the panel holding it — with a bespoke
        `focus:ring-2 focus:ring-ring` that skipped the border swap, which
        `focus.ts` calls the load-bearing half of the indicator (the ring alone
        composites to ~1.3:1, under the 3:1 non-text floor).
      */}
      <Frimousse.Search
        autoFocus
        className={cn(
          "m-2 rounded-md border border-input bg-surface-1 px-3 py-2 text-base outline-none transition-colors",
          FOCUS_RING,
        )}
        placeholder="Search emoji…"
      />
      <Frimousse.Viewport className="relative flex-1 overflow-y-auto px-1 pb-1">
        <Frimousse.Loading className="p-3 text-[12.5px] text-muted-foreground">
          Loading…
        </Frimousse.Loading>
        <Frimousse.Empty className="p-3 text-[12.5px] text-muted-foreground">
          No emoji matches.
        </Frimousse.Empty>
        <Frimousse.List
          components={{
            CategoryHeader: CategoryHeader,
            Row: Row,
            Emoji: EmojiButton,
          }}
        />
      </Frimousse.Viewport>
    </Frimousse.Root>
  );
}

function CategoryHeader({ category, ...rest }: EmojiPickerListCategoryHeaderProps) {
  return (
    <div
      {...rest}
      className="bg-popover px-2 pb-1 pt-2 text-[12.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground"
    >
      {category.label}
    </div>
  );
}

function Row({ children, ...rest }: EmojiPickerListRowProps) {
  return (
    <div {...rest} className="flex">
      {children}
    </div>
  );
}

/**
 * One grid cell.
 *
 * **Two bugs lived in the class string this replaces**, and both are the same
 * shape the primitives slice found four of:
 *
 * 1. `hover:bg-accent` and `data-[active]:bg-secondary` both set
 *    `background-color` at equal specificity, and Tailwind breaks that tie by
 *    its own variant sort order rather than by the order they are written.
 *    Nothing here is `disabled`, so the `enabled:` scoping the primitives slice
 *    used is unavailable — the fix is to make the losing rule not matter. The
 *    active cell now differs by **border as well as fill**, so it stays
 *    identifiable whichever rule wins. Checked in the compiled stylesheet
 *    rather than assumed: Tailwind emits the `data-[…]` rule *after* the
 *    `hover:` one, so active does win and a hovered active cell keeps its
 *    active paint. (Emission order is the durable fact; byte offsets differ
 *    between the dev and production builds and neither is committed, so do not
 *    cite one.)
 * 2. `bg-secondary` and `bg-accent` are the *card* and *popover* values, and
 *    this panel is `bg-popover` — so "active" was painting the cell in its own
 *    background. components.md §2 spells the rule out: a highlighted row inside
 *    a popover-surfaced primitive takes the accent tint, never a surface step,
 *    because the ladder's steps are ~1.1:1 apart and cannot carry "this one" on
 *    luminance alone.
 *
 * 38px is the §3 Compact size — pointer-only, which an emoji grid in a popover
 * is. A 44px cell would make the picker a third wider than the panel it lives
 * in.
 */
function EmojiButton({ emoji, ...rest }: EmojiPickerListEmojiProps) {
  return (
    <button
      {...rest}
      type="button"
      aria-label={emoji.label}
      className={cn(
        "flex h-[38px] w-[38px] items-center justify-center rounded-sm border border-transparent text-base transition-colors",
        "hover:bg-accent-subtle/60",
        "data-[active]:border-accent-border data-[active]:bg-accent-subtle",
        FOCUS_RING,
      )}
    >
      {emoji.emoji}
    </button>
  );
}
