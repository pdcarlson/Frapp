"use client";

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
      <Frimousse.Search
        autoFocus
        className="m-2 rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
        placeholder="Search emoji…"
      />
      <Frimousse.Viewport className="relative flex-1 overflow-y-auto px-1 pb-1">
        <Frimousse.Loading className="p-3 text-xs text-muted-foreground">
          Loading…
        </Frimousse.Loading>
        <Frimousse.Empty className="p-3 text-xs text-muted-foreground">
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
      className="bg-popover px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
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

function EmojiButton({ emoji, ...rest }: EmojiPickerListEmojiProps) {
  return (
    <button
      {...rest}
      type="button"
      aria-label={emoji.label}
      className="flex h-8 w-8 items-center justify-center rounded text-base hover:bg-accent data-[active]:bg-secondary"
    >
      {emoji.emoji}
    </button>
  );
}
