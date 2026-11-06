import { lastChannelStorageKey } from "@repo/hooks";

/**
 * The member's last channel on this browser, per chapter
 * (`@repo/hooks` `landing-channel.ts` owns the rule that reads it).
 *
 * localStorage, best-effort: a private window, blocked site data or a full
 * quota throws or reads empty, and Chat then opens on `#general` as before.
 */
export function readLastChannel(
  userId: string | null | undefined,
  chapterId: string | null | undefined,
): string | null {
  if (!userId || !chapterId || typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(
      lastChannelStorageKey(userId, chapterId),
    );
  } catch {
    return null;
  }
}

export function writeLastChannel(
  userId: string | null | undefined,
  chapterId: string | null | undefined,
  channelId: string,
): void {
  if (!userId || !chapterId || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      lastChannelStorageKey(userId, chapterId),
      channelId,
    );
  } catch {
    /* Best-effort: the next open falls back to #general. */
  }
}
