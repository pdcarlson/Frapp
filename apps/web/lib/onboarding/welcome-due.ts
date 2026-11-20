/**
 * The welcome card is due (#5627; Paul's pick 2026-11-19, "welcome card, no
 * tour"): set when a member leaves `/welcome` after joining, read by Chat,
 * which shows the card once in the chapter's default channel
 * (`components/onboarding/welcome-card.tsx`), and by What's new, which sits
 * out while it is due.
 *
 * Kept in this browser, per member and chapter, as the phone keeps its own
 * (`apps/mobile/lib/onboarding/welcome-due.ts`). Storage that throws (a
 * private window, blocked site data) means no card, never a broken page.
 */
export const WELCOME_DUE_STORAGE_KEY = "frapp.welcome-due";

function value(userId: string, chapterId: string): string {
  return `${userId}:${chapterId}`;
}

export function markWelcomeDue(userId: string, chapterId: string): void {
  try {
    window.localStorage.setItem(
      WELCOME_DUE_STORAGE_KEY,
      value(userId, chapterId),
    );
  } catch {
    // No card is the failure; the member still reaches chat.
  }
}

export function isWelcomeDue(
  userId: string | null,
  chapterId: string | null,
): boolean {
  if (!userId || !chapterId) return false;
  try {
    return (
      window.localStorage.getItem(WELCOME_DUE_STORAGE_KEY) ===
      value(userId, chapterId)
    );
  } catch {
    return false;
  }
}

export function clearWelcomeDue(): void {
  try {
    window.localStorage.removeItem(WELCOME_DUE_STORAGE_KEY);
  } catch {
    // It shows once more at worst.
  }
}
