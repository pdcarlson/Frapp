/**
 * The cards Activity is made of (#5520), named by key, shared by the API that
 * stores a member's arrangement and by both clients that draw it.
 *
 * The page is a stack of cards the member orders and hides (Paul's pick,
 * 2026-11-18, direction A). The rule is `spec/behavior/activity.md` § Cards.
 *
 * The API stores any well-formed key, not only the ones listed here, so a
 * client that knows a card this API was built before can still save it; each
 * client ignores a stored key it doesn't know. The week card isn't a key: it
 * is always first and can't be hidden, as Apple Fitness keeps its rings.
 */

/** Every card a member may move or hide, in no particular order. */
export const ACTIVITY_CARD_KEYS = [
  "nudge",
  "recap",
  "review",
  "todo",
  "calendar",
  "reminders",
  "waiting",
  "links",
  "semester",
] as const;

export type ActivityCardKey = (typeof ACTIVITY_CARD_KEYS)[number];

/** Whether a string names a card this build knows. */
export function isActivityCardKey(value: unknown): value is ActivityCardKey {
  return (
    typeof value === "string" &&
    (ACTIVITY_CARD_KEYS as readonly string[]).includes(value)
  );
}

/**
 * What the API stores: lower-case words joined by hyphens, at most 32
 * characters. Wider than {@link ACTIVITY_CARD_KEYS} on purpose (above).
 */
export const ACTIVITY_CARD_KEY_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;

/** The most keys either list may hold, so a row stays small whatever a client sends. */
export const ACTIVITY_LAYOUT_MAX_KEYS = 32;
