import { EMOJI_GROUPS, type EmojiGroup } from "./emoji-data";
import { emojiKey } from "./emoji-recent";

export { canonicalEmoji, emojiKey } from "./emoji-recent";

/**
 * The emoji pickers' rows and search, shared by web's popover
 * (`apps/web/components/chat/emoji-picker-panel.tsx`) and mobile's sheet
 * (`apps/mobile/components/chat/emoji-picker-sheet.tsx`), so both offer the
 * same emoji under the same names and a search finds the same thing on each.
 *
 * This module imports the ~110 KB catalog. Anything that only needs the
 * member's recent emoji or the quick reactions imports `./emoji-recent`,
 * which does not, so the catalog stays in the picker's own lazy chunk.
 */

/**
 * The rows a picker draws: a section heading, or one line of emoji. The list
 * is flat so one virtualized list can draw ~1,850 emoji without laying out
 * the ones off screen.
 */
export type EmojiPickerRow =
  | { kind: "heading"; key: string; name: string }
  | { kind: "emoji"; key: string; emojis: string[] };

/** Emoji per line: eight 44pt cells fit the narrowest supported phone. */
export const EMOJI_COLUMNS = 8;

/** The heading over the member's recent emoji, Slack's and Discord's first section. */
const RECENT_EMOJI_HEADING = "Recent";

function emojiOf(entry: string): string {
  return entry.slice(0, entry.indexOf("|"));
}

function chunk(
  emojis: readonly string[],
  columns: number,
  keyPrefix: string,
): EmojiPickerRow[] {
  const rows: EmojiPickerRow[] = [];
  for (let i = 0; i < emojis.length; i += columns) {
    rows.push({
      kind: "emoji",
      key: `${keyPrefix}-${i}`,
      emojis: emojis.slice(i, i + columns),
    });
  }
  return rows;
}

let labels: Map<string, string> | null = null;

/**
 * An emoji's name ("face with tears of joy"), for the web picker's footer
 * and an accessible label. Matched without variation selectors, so a recent
 * stored as `👍` finds emojibase's `👍️`. Undefined for one the catalog
 * doesn't hold.
 */
export function emojiLabel(emoji: string): string | undefined {
  if (!labels) {
    labels = new Map();
    for (const group of EMOJI_GROUPS) {
      for (const entry of group.entries) {
        const [e, label = ""] = entry.split("|");
        labels.set(emojiKey(e!), label);
      }
    }
  }
  return labels.get(emojiKey(emoji));
}

/**
 * The picker's rows for a search. Empty search: the member's recent emoji
 * (when there are any) under "Recent", then every group under its heading,
 * in emojibase order. Otherwise one unheaded block of the emoji whose name or
 * tags contain every word typed, best match first: the emoji named exactly
 * what was typed, then names that start with it, then any other name holding
 * it, then tags only. "fire" puts the flame ahead of the firefighter, and both
 * ahead of the fire engine's tags.
 */
export function emojiPickerRows(
  search: string,
  {
    columns = EMOJI_COLUMNS,
    groups = EMOJI_GROUPS,
    recent = [],
    hidden,
  }: {
    columns?: number;
    groups?: readonly EmojiGroup[];
    /** Most recent first (`@repo/chat-core/emoji-recent`). */
    recent?: readonly string[];
    /**
     * Emoji to leave out, by `emojiKey`: what this device can't draw (web's
     * `drawableEmoji`). A group left empty loses its heading too.
     */
    hidden?: ReadonlySet<string>;
  } = {},
): EmojiPickerRow[] {
  const shown = (emoji: string) => !hidden?.has(emojiKey(emoji));
  const query = search.toLowerCase().trim().replace(/\s+/g, " ");
  if (!query) {
    const recentRows: EmojiPickerRow[] = recent.some(shown)
      ? [
          {
            kind: "heading",
            key: "h-recent",
            name: RECENT_EMOJI_HEADING,
          },
          ...chunk(recent.filter(shown), columns, "recent"),
        ]
      : [];
    return [
      ...recentRows,
      ...groups.flatMap((group): EmojiPickerRow[] => {
        const emojis = group.entries.map(emojiOf).filter(shown);
        if (emojis.length === 0) return [];
        return [
          { kind: "heading", key: `h-${group.name}`, name: group.name },
          ...chunk(emojis, columns, group.name),
        ];
      }),
    ];
  }
  const words = query.split(" ");
  const ranked: { emoji: string; rank: number; order: number }[] = [];
  let order = 0;
  for (const group of groups) {
    for (const entry of group.entries) {
      order += 1;
      const [emoji, label = "", tags = ""] = entry.split("|");
      if (!shown(emoji!)) continue;
      const text = `${label} ${tags}`;
      if (!words.every((word) => text.includes(word))) continue;
      const rank =
        label === query
          ? 0
          : label.startsWith(query)
            ? 1
            : label.includes(query)
              ? 2
              : 3;
      ranked.push({ emoji: emoji!, rank, order });
    }
  }
  ranked.sort((a, b) => a.rank - b.rank || a.order - b.order);
  return chunk(
    ranked.map((r) => r.emoji),
    columns,
    "search",
  );
}
