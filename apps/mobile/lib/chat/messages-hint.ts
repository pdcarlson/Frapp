import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * The hint that teaches the swipe from Chat home to Messages (#3774, #4610
 * step 3; `spec/ui/mobile/navigation.md` § Global entries, Swipe to
 * Messages).
 *
 * Nothing on Chat home said the swipe was there: the team's read on
 * 2026-11-12 was that nobody finds it. Apple's guidance on a custom gesture is
 * that the app owes a moment that teaches it, feedback while it happens, and
 * another way to do the same thing. The Messages door is the other way; this
 * module decides when the teaching moment happens, and
 * `components/chat/messages-swipe-area.tsx` draws it and the feedback.
 *
 * ## When it shows
 *
 * - **Once**, the first time the member rests on Chat home after this ships:
 *   the list has loaded, nothing is open over it, and the first-run tour is
 *   not due.
 * - **Once more**, at least {@link MESSAGES_HINT_REPEAT_MS} later, and only
 *   while a direct message is unread: the one moment the swipe is the fastest
 *   way to what the member wants.
 * - **Never** after the member has swiped to Messages, and never a third time.
 *   A hint that keeps coming back is a nag, and one that showed twice to
 *   someone who uses the door has said what it has to say.
 *
 * Kept per member on this phone, like the first-run tour, so a second account
 * on the same phone gets its own.
 */

export interface MessagesHintRecord {
  /** The member has opened Messages with the swipe. */
  swiped: boolean;
  /** How many times the hint has played. */
  shown: number;
  /** When it last played, in epoch ms. */
  lastShownAt: number | null;
}

export const MESSAGES_HINT_FRESH: MessagesHintRecord = {
  swiped: false,
  shown: 0,
  lastShownAt: null,
};

/** The first show, and one reminder. */
const MESSAGES_HINT_MAX_SHOWS = 2;

/** Three days before the reminder, as the push reminder waits. */
export const MESSAGES_HINT_REPEAT_MS = 3 * 24 * 60 * 60 * 1000;

/** What the capsule says. */
export const MESSAGES_HINT_TEXT = "Swipe left for Messages";

/** Whether the hint should play now. */
export function shouldShowMessagesHint(
  record: MessagesHintRecord,
  now: number,
  unreadConversations: number,
): boolean {
  if (record.swiped) return false;
  if (record.shown === 0) return true;
  if (record.shown >= MESSAGES_HINT_MAX_SHOWS) return false;
  if (unreadConversations <= 0) return false;
  return (
    record.lastShownAt !== null &&
    now - record.lastShownAt >= MESSAGES_HINT_REPEAT_MS
  );
}

/** The record after the hint has played. */
export function messagesHintShown(
  record: MessagesHintRecord,
  now: number,
): MessagesHintRecord {
  return { ...record, shown: record.shown + 1, lastShownAt: now };
}

/** The record after the member has swiped to Messages. */
export function messagesHintSwiped(
  record: MessagesHintRecord,
): MessagesHintRecord {
  return { ...record, swiped: true };
}

// ── How far the screen moves ────────────────────────────────────────────────

/** How far the hint slides Chat home left to show the Messages edge. */
export const MESSAGES_PEEK = 56;

/** The furthest a real slide moves the screen before release. */
export const MESSAGES_FOLLOW_MAX = 72;

/**
 * How far Chat home has moved under a slide. `travel` is how far the finger
 * has gone since the pan took the touch over, negative to the left: the
 * screen moves 60% of it, stopping at {@link MESSAGES_FOLLOW_MAX}. It gives a
 * little and resists, so the screen says "something is over there" without
 * pretending Messages is being dragged in: Messages still opens on release.
 * Always zero or negative.
 *
 * The caller measures `travel` from the pan's first update, not from
 * touch-down: gesture-handler zeroes a pan's translation when it activates on
 * iOS and Android, and doesn't everywhere else.
 */
export function messagesFollowOffset(travel: number): number {
  if (travel >= 0) return 0;
  // `|| 0`: a multiply by a negative zero must not leave a `-0` in a style.
  return Math.max(travel * 0.6, -MESSAGES_FOLLOW_MAX) || 0;
}

// ── Storage ─────────────────────────────────────────────────────────────────

const STORAGE_KEY_PREFIX = "frapp.mobile.messages-swipe-hint:";

type Storage = Pick<typeof AsyncStorage, "getItem" | "setItem">;

function parse(raw: string | null): MessagesHintRecord {
  if (!raw) return MESSAGES_HINT_FRESH;
  try {
    const value = JSON.parse(raw) as Partial<MessagesHintRecord> | null;
    if (!value || typeof value !== "object") return MESSAGES_HINT_FRESH;
    return {
      swiped: value.swiped === true,
      shown:
        typeof value.shown === "number" && value.shown > 0
          ? Math.floor(value.shown)
          : 0,
      lastShownAt:
        typeof value.lastShownAt === "number" ? value.lastShownAt : null,
    };
  } catch {
    return MESSAGES_HINT_FRESH;
  }
}

/**
 * The member's record, or `null` when storage can't be read: with no record
 * the hint stays quiet, because one that can't remember it played would play
 * on every visit.
 */
export async function readMessagesHint(
  userId: string,
  storage: Storage = AsyncStorage,
): Promise<MessagesHintRecord | null> {
  try {
    return parse(await storage.getItem(STORAGE_KEY_PREFIX + userId));
  } catch {
    return null;
  }
}

/**
 * Keeps the record. Answers whether it was kept, because the hint must not
 * play on a write that failed: a phone that reads but can't write would then
 * play it on every visit.
 */
export async function writeMessagesHint(
  userId: string,
  record: MessagesHintRecord,
  storage: Storage = AsyncStorage,
): Promise<boolean> {
  try {
    await storage.setItem(STORAGE_KEY_PREFIX + userId, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}
