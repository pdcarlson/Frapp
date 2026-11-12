"use client";

import { useCallback, useId, useMemo, useRef, useState } from "react";
import {
  emojiLabel,
  emojiPickerRows,
  type EmojiPickerRow,
} from "@repo/chat-core/emoji";
import { FOCUS_RING } from "@/components/ui/focus";
import { EYEBROW } from "@/components/ui/typography";
import { recordRecentEmoji, useRecentEmoji } from "@/lib/chat/recent-emoji";
import { cn } from "@/lib/utils";

/**
 * The emoji picker's panel: a search field, the member's recent emoji, then
 * every emoji by group, with the hovered or arrowed-to emoji named in a footer.
 *
 * Built on the catalog mobile's sheet draws (`@repo/chat-core/emoji`), which
 * ships inside this module's own lazy chunk. It replaced `frimousse`, which
 * fetched emojibase from jsDelivr and re-checked it on every new tab, so the
 * first open of a session showed "Loading…" for a network round trip. Now an
 * open costs one chunk the trigger already started fetching on hover
 * (`preloadEmojiPicker` in `emoji-picker.tsx`), and nothing after that.
 *
 * Shaped after Slack's and Discord's pickers, which both open on the
 * member's recent emoji, keep focus in the search field so typing filters at
 * once and Enter picks the first match, move through the grid with the arrow
 * keys, and name the emoji under the pointer in a footer. Neither's category
 * tab row is here: search and recents cover the reach, and the section name
 * pinned at the top of the grid says where the scroll is.
 *
 * Not imported directly by anything but `emoji-picker.tsx`, the boundary that
 * keeps the catalog out of the chunk that gates first paint.
 */

/** 8 columns of 38px cells (the §3 Compact size), plus the 4px gutters. */
const COLUMNS = 8;
const CELL = 38;
const HEADING = 28;
/** Rows drawn above and below the visible ones, so a fast scroll stays filled. */
const OVERSCAN = 4;
/** The grid's height: six and a half lines, so the half line says it scrolls. */
const VIEWPORT = CELL * 6 + CELL / 2;

interface Placed {
  row: EmojiPickerRow;
  top: number;
  height: number;
}

/** Each row with its offset from the top of the grid. */
function placeRows(rows: readonly EmojiPickerRow[]): Placed[] {
  const placed: Placed[] = [];
  let top = 0;
  for (const row of rows) {
    const height = row.kind === "heading" ? HEADING : CELL;
    placed.push({ row, top, height });
    top += height;
  }
  return placed;
}

/** Where an arrowed-to emoji is: its row in `rows`, and its column. */
interface Cursor {
  row: number;
  col: number;
}

export function EmojiPickerPanel({
  onPick,
}: {
  onPick: (emoji: string) => void;
}) {
  const id = useId();
  const recent = useRecentEmoji();
  const [search, setSearch] = useState("");
  const [scrollTop, setScrollTop] = useState(0);
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const viewport = useRef<HTMLDivElement>(null);

  // The recents are read once per open: a pick closes the panel, so the list
  // never reshuffles under the pointer.
  const [openingRecent] = useState(recent);
  const rows = useMemo(
    () => emojiPickerRows(search, { columns: COLUMNS, recent: openingRecent }),
    [search, openingRecent],
  );
  const placed = useMemo(() => placeRows(rows), [rows]);
  const total = placed.length
    ? placed[placed.length - 1]!.top + placed[placed.length - 1]!.height
    : 0;

  const firstEmojiRow = rows.findIndex((row) => row.kind === "emoji");
  // With no arrow move yet, the first emoji is the one Enter picks and the
  // footer names, as in Slack and Discord.
  const active: Cursor | null =
    cursor ?? (firstEmojiRow >= 0 ? { row: firstEmojiRow, col: 0 } : null);
  const activeRow = active ? rows[active.row] : undefined;
  const activeEmoji =
    active && activeRow?.kind === "emoji"
      ? activeRow.emojis[active.col]
      : undefined;

  const pick = useCallback(
    (emoji: string) => {
      recordRecentEmoji(emoji);
      onPick(emoji);
    },
    [onPick],
  );

  // The visible slice, by binary search over the rows' tops.
  const { from, to } = useMemo(() => {
    let lo = 0;
    let hi = placed.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (placed[mid]!.top <= scrollTop) lo = mid;
      else hi = mid - 1;
    }
    let end = lo;
    while (end < placed.length && placed[end]!.top < scrollTop + VIEWPORT) {
      end += 1;
    }
    return {
      from: Math.max(0, lo - OVERSCAN),
      to: Math.min(placed.length, end + OVERSCAN),
    };
  }, [placed, scrollTop]);

  // The section the top of the grid is in, pinned over it while scrolling.
  const pinnedHeading = useMemo(() => {
    if (search.trim()) return null;
    for (let i = Math.min(from + OVERSCAN, placed.length - 1); i >= 0; i -= 1) {
      const row = placed[i]!.row;
      if (placed[i]!.top <= scrollTop && row.kind === "heading") {
        return placed[i]!.top < scrollTop ? row.name : null;
      }
    }
    return null;
  }, [from, placed, scrollTop, search]);

  const reveal = (rowIndex: number) => {
    const el = viewport.current;
    const at = placed[rowIndex];
    if (!el || !at) return;
    // Clear of the pinned heading when scrolling up to a line.
    const topEdge = at.top - (rowIndex > 0 ? HEADING : 0);
    if (topEdge < el.scrollTop) el.scrollTop = Math.max(0, topEdge);
    else if (at.top + at.height > el.scrollTop + VIEWPORT) {
      el.scrollTop = at.top + at.height - VIEWPORT;
    }
  };

  /** The next emoji line from `row` in `step` direction, skipping headings. */
  const lineFrom = (row: number, step: 1 | -1): number | null => {
    for (let i = row + step; i >= 0 && i < rows.length; i += step) {
      if (rows[i]!.kind === "emoji") return i;
    }
    return null;
  };

  const lengthOf = (row: number) => {
    const r = rows[row];
    return r?.kind === "emoji" ? r.emojis.length : 0;
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!active) return;
    let next: Cursor | null = null;
    switch (event.key) {
      case "ArrowRight":
        if (active.col + 1 < lengthOf(active.row)) {
          next = { row: active.row, col: active.col + 1 };
        } else {
          const line = lineFrom(active.row, 1);
          if (line !== null) next = { row: line, col: 0 };
        }
        break;
      case "ArrowLeft":
        if (active.col > 0) next = { row: active.row, col: active.col - 1 };
        else {
          const line = lineFrom(active.row, -1);
          if (line !== null) next = { row: line, col: lengthOf(line) - 1 };
        }
        break;
      case "ArrowDown":
      case "ArrowUp": {
        const line = lineFrom(active.row, event.key === "ArrowDown" ? 1 : -1);
        if (line !== null) {
          next = { row: line, col: Math.min(active.col, lengthOf(line) - 1) };
        }
        break;
      }
      case "Enter":
        event.preventDefault();
        if (activeEmoji) pick(activeEmoji);
        return;
      default:
        return;
    }
    // The caret stays put: arrows belong to the grid while it has a cursor.
    event.preventDefault();
    if (next) {
      setCursor(next);
      reveal(next.row);
    }
  };

  const cellId = (row: number, col: number) => `${id}-${row}-${col}`;

  return (
    <div className="flex h-[336px] w-[312px] flex-col rounded-md border border-border bg-popover text-popover-foreground">
      {/*
        The field is `--surface-1` inside a `--popover` panel and takes the
        shared focus recipe (`focus.ts`): border swap plus ring, where the ring
        alone composites under the 3:1 non-text floor.
      */}
      <input
        autoFocus
        type="text"
        role="combobox"
        aria-expanded="true"
        aria-controls={`${id}-grid`}
        aria-activedescendant={
          active && activeEmoji ? cellId(active.row, active.col) : undefined
        }
        aria-label="Search emoji"
        placeholder="Search emoji"
        autoComplete="off"
        spellCheck={false}
        value={search}
        onChange={(event) => {
          setSearch(event.target.value);
          setCursor(null);
          setScrollTop(0);
          if (viewport.current) viewport.current.scrollTop = 0;
        }}
        onKeyDown={onKeyDown}
        className={cn(
          "m-2 rounded-md border border-control-edge bg-surface-1 px-3 py-2 text-base outline-none transition-colors",
          FOCUS_RING,
        )}
      />
      <div className="relative min-h-0 flex-1">
        {pinnedHeading ? (
          <div
            aria-hidden="true"
            className={cn(
              "absolute inset-x-1 top-0 z-10 flex h-7 items-end bg-popover px-2 pb-1 text-muted-foreground",
              EYEBROW,
            )}
          >
            {pinnedHeading}
          </div>
        ) : null}
        <div
          ref={viewport}
          id={`${id}-grid`}
          role="listbox"
          aria-label="Emoji"
          className="h-full overflow-y-auto px-1"
          onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        >
          {rows.length === 0 ? (
            <p className="p-3 text-caption text-muted-foreground">
              No emoji match that search.
            </p>
          ) : (
            <div className="relative" style={{ height: total }}>
              {placed.slice(from, to).map(({ row, top, height }, offset) => {
                const rowIndex = from + offset;
                if (row.kind === "heading") {
                  return (
                    <div
                      key={row.key}
                      role="presentation"
                      className={cn(
                        "absolute inset-x-0 flex items-end px-2 pb-1 text-muted-foreground",
                        EYEBROW,
                      )}
                      style={{ top, height }}
                    >
                      {row.name}
                    </div>
                  );
                }
                return (
                  <div
                    key={row.key}
                    role="presentation"
                    className="absolute inset-x-0 flex"
                    style={{ top, height }}
                  >
                    {row.emojis.map((emoji, col) => {
                      const isActive =
                        active?.row === rowIndex && active.col === col;
                      return (
                        <EmojiCell
                          key={emoji}
                          id={cellId(rowIndex, col)}
                          emoji={emoji}
                          active={isActive}
                          onHover={() => setCursor({ row: rowIndex, col })}
                          onPick={pick}
                        />
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      <div
        aria-hidden="true"
        className="flex h-9 shrink-0 items-center gap-2 border-t border-border px-3 text-caption text-muted-foreground"
      >
        {activeEmoji ? (
          <>
            <span className="text-lg leading-none">{activeEmoji}</span>
            <span className="truncate">{emojiLabel(activeEmoji)}</span>
          </>
        ) : null}
      </div>
    </div>
  );
}

/**
 * One grid cell. Pointer-only focus: the search field keeps focus and names
 * the active cell through `aria-activedescendant`, as a combobox does, so the
 * cells take `tabIndex={-1}` and a Tab from the field leaves the panel.
 *
 * The active cell differs by border as well as fill, so it stays visible
 * whichever of hover and active Tailwind sorts last (both set the fill).
 * Both take `--card-hover`, the neutral step above the ladder: active is the
 * menu highlight, not a place the member is (`foundations.md` §6).
 *
 * `onMouseDown` keeps focus in the field, so a click does not blur it and
 * hand the ring to a cell that is about to close with the panel.
 */
function EmojiCell({
  id,
  emoji,
  active,
  onHover,
  onPick,
}: {
  id: string;
  emoji: string;
  active: boolean;
  onHover: () => void;
  onPick: (emoji: string) => void;
}) {
  const label = emojiLabel(emoji) ?? emoji;
  return (
    <button
      id={id}
      type="button"
      role="option"
      aria-selected={active}
      aria-label={label}
      tabIndex={-1}
      onMouseDown={(event) => event.preventDefault()}
      onMouseEnter={onHover}
      onClick={() => onPick(emoji)}
      className={cn(
        "flex h-[38px] w-[38px] items-center justify-center rounded-sm border border-transparent text-xl leading-none transition-colors",
        "hover:bg-card-hover",
        active && "border-border bg-card-hover",
      )}
    >
      {emoji}
    </button>
  );
}
