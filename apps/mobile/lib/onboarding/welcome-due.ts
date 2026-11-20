import AsyncStorage from "@react-native-async-storage/async-storage";
import { readWelcomeDueMark, welcomeDueMark } from "@repo/validation";

/**
 * The welcome card is due (#5627; Paul's pick 2026-11-19, "welcome card, no
 * tour"): set when a member leaves s03 after joining, read by the chapter's
 * default channel, which shows the card once (`components/onboarding/
 * welcome-card.tsx`), and by What's new, which sits out while it is due so a
 * new member's first minute is the chapter rather than what changed before
 * they came.
 *
 * Kept on the phone, per member and chapter, as the first-run tour's mark was
 * (`frapp.mobile.tour-due` until #5627): it is this phone's first minute in
 * the chapter. Web keeps its own (`apps/web/lib/onboarding/welcome-due.ts`).
 * It lapses after `WELCOME_CARD_DAYS` (`welcomeDueMark` in
 * `@repo/validation`), so What's new isn't held for good.
 */
export const WELCOME_DUE_STORAGE_KEY = "frapp.mobile.welcome-due";

type Storage = Pick<typeof AsyncStorage, "getItem" | "setItem" | "removeItem">;

/**
 * A token with no `active_chapter_id` is a normal working state (a sole
 * membership resolved server-side), so a missing chapter still gets a stable
 * mark, as `lib/chat/last-channel.ts` keys it.
 */
function chapterKey(chapterId: string | null): string {
  return chapterId ?? "sole";
}

export async function markWelcomeDue(
  userId: string,
  chapterId: string | null,
  storage: Storage = AsyncStorage,
): Promise<void> {
  try {
    await storage.setItem(
      WELCOME_DUE_STORAGE_KEY,
      welcomeDueMark(userId, chapterKey(chapterId)),
    );
  } catch {
    // No card is the failure; the member still reaches chat.
  }
}

export async function isWelcomeDue(
  userId: string,
  chapterId: string | null,
  storage: Storage = AsyncStorage,
): Promise<boolean> {
  try {
    const mark = readWelcomeDueMark(
      await storage.getItem(WELCOME_DUE_STORAGE_KEY),
    );
    return mark?.userId === userId && mark.chapterKey === chapterKey(chapterId);
  } catch {
    return false;
  }
}

/** Whether a card is due for this member in any chapter (What's new waits). */
export async function isWelcomeDueForMember(
  userId: string,
  storage: Storage = AsyncStorage,
): Promise<boolean> {
  try {
    const mark = readWelcomeDueMark(
      await storage.getItem(WELCOME_DUE_STORAGE_KEY),
    );
    return mark?.userId === userId;
  } catch {
    return false;
  }
}

export async function clearWelcomeDue(
  storage: Storage = AsyncStorage,
): Promise<void> {
  try {
    await storage.removeItem(WELCOME_DUE_STORAGE_KEY);
  } catch {
    // It shows once more at worst.
  }
}

/*
  Landing a new member in the chapter's default channel, once. s03 ends long
  after the launch window of `lib/chat/last-channel.ts` has closed, so chat
  home's launch jump would leave a new member on the channel list. Chat home
  claims this instead, once per member and chapter in this app process, and
  opens `landingChannelId` when the card is due.
*/
const landed = new Set<string>();

export function claimWelcomeLanding(
  userId: string,
  chapterId: string | null,
): boolean {
  const mark = `${userId}:${chapterKey(chapterId)}`;
  if (landed.has(mark)) return false;
  landed.add(mark);
  return true;
}

export function resetWelcomeLandingForTests(): void {
  landed.clear();
}
