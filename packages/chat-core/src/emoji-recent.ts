/**
 * The member's recent emoji and the quick reactions, without the emoji
 * catalog (`./emoji` imports that), so a message row's quick-reaction bar can
 * record a use without pulling ~110 KB into the chunk that paints the thread.
 *
 * Recent, not frequent: the list is most-recently-used, as iMessage's tapback
 * row and keyboard keep it. Discord's count-ranked "Frequently used" is the
 * one its members ask to reset, because an emoji used a lot last month holds
 * its slot long after they've moved on. Kept per device (localStorage on web,
 * AsyncStorage on mobile), like the system keyboards' own recents.
 */

/**
 * The four one-tap reactions on web's hover bar and mobile's long-press
 * sheet, in that order on both. One list so the two can't drift.
 */
export const QUICK_REACTIONS: readonly string[] = ["👍", "🙏", "✅", "🔥"];

/** How many recent emoji a picker shows: two lines of eight. */
export const RECENT_EMOJI_LIMIT = 16;

/** Storage key on both surfaces. `v1`: a space-separated list, newest first. */
export const RECENT_EMOJI_STORAGE_KEY = "frapp.recent-emoji.v1";

/**
 * An emoji with its variation selectors dropped, for comparing two spellings
 * of one emoji: emojibase writes thumbs up as `👍️` (with U+FE0F), the quick
 * row and older reactions as `👍`. Reactions are keyed by the exact string, so
 * a picker must hand back the spelling already in use.
 */
export function emojiKey(emoji: string): string {
  return emoji.replace(/[︎️]/gu, "");
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

/** `emoji` moved to the front of `recent`, once, capped at the limit. */
export function withRecentEmoji(
  recent: readonly string[],
  emoji: string,
): string[] {
  const key = emojiKey(emoji);
  return [emoji, ...recent.filter((e) => emojiKey(e) !== key)].slice(
    0,
    RECENT_EMOJI_LIMIT,
  );
}

/**
 * The stored list, read defensively: storage is the member's own browser or
 * phone, but a value from an older build or a hand edit must not put a
 * paragraph in a 38px cell. An emoji is at most a few code points (the longest
 * ZWJ family is 11), so anything longer, or anything with a letter or digit in
 * it, is dropped.
 */
export function parseRecentEmoji(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const token of raw.split(" ")) {
    if (!token || [...token].length > 12 || /[\p{L}\p{N}]/u.test(token)) {
      // Keycaps (`1️⃣`) carry a digit; let the combining keycap through.
      if (!/^[0-9#*]️?⃣$/u.test(token)) continue;
    }
    const key = emojiKey(token);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(token);
    if (out.length === RECENT_EMOJI_LIMIT) break;
  }
  return out;
}

export function serializeRecentEmoji(recent: readonly string[]): string {
  return recent.join(" ");
}
