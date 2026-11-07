import { EMOJI_GROUPS, type EmojiGroup } from "./emoji-data";

/**
 * The rows the emoji picker draws: a section heading, or one line of emoji.
 * The list is flat so one virtualized list can draw ~1,850 emoji without
 * laying out the ones off screen.
 */
export type EmojiPickerRow =
  | { kind: "heading"; key: string; name: string }
  | { kind: "emoji"; key: string; emojis: string[] };

/**
 * An emoji with its variation selectors dropped, for comparing two spellings
 * of one emoji: emojibase writes thumbs up as `👍️` (with U+FE0F), the quick
 * row and older reactions as `👍`. Reactions are keyed by the exact string, so
 * the picker must hand back the spelling already in use.
 */
export function emojiKey(emoji: string): string {
  return emoji.replace(/[\uFE0E\uFE0F]/gu, "");
}

/**
 * The spelling to react with: one of `existing` (the quick row, the message's
 * current reactions) when it is the same emoji, else the picker's own.
 */
export function canonicalEmoji(
  emoji: string,
  existing: readonly string[],
): string {
  const key = emojiKey(emoji);
  return existing.find((e) => emojiKey(e) === key) ?? emoji;
}

/** Emoji per line: eight 44pt cells fit the narrowest supported phone. */
export const EMOJI_COLUMNS = 8;

function emojiOf(entry: string): string {
  return entry.slice(0, entry.indexOf("|"));
}

function chunk(
  emojis: string[],
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

/**
 * The picker's rows for a search. Empty search: every group under its
 * heading, in emojibase order. Otherwise one unheaded block of the emoji
 * whose name or tags contain every word typed, best match first: the emoji
 * named exactly what was typed, then names that start with it, then any
 * other name holding it, then tags only. "fire" puts the flame ahead of the
 * firefighter, and both ahead of the fire engine's tags.
 */
export function emojiPickerRows(
  search: string,
  columns: number = EMOJI_COLUMNS,
  groups: readonly EmojiGroup[] = EMOJI_GROUPS,
): EmojiPickerRow[] {
  const query = search.toLowerCase().trim().replace(/\s+/g, " ");
  if (!query) {
    return groups.flatMap((group) => [
      { kind: "heading", key: `h-${group.name}`, name: group.name } as const,
      ...chunk(group.entries.map(emojiOf), columns, group.name),
    ]);
  }
  const words = query.split(" ");
  const ranked: { emoji: string; rank: number; order: number }[] = [];
  let order = 0;
  for (const group of groups) {
    for (const entry of group.entries) {
      order += 1;
      const [emoji, label = "", tags = ""] = entry.split("|");
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
