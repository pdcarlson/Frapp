import { lastChannelStorageKey } from "@repo/hooks";
import type { ChatView } from "@/components/layout/shell-prefs";

/**
 * Channels and direct messages each remember their own last conversation
 * (#3774), so switching the panel between them goes back to where the member
 * was in each. Channels keep the shared key mobile reads too; direct messages
 * add a suffix, since the phone keeps its own Messages screen.
 */
function storageKey(userId: string, chapterId: string, view: ChatView): string {
  const key = lastChannelStorageKey(userId, chapterId);
  return view === "direct" ? `${key}.direct` : key;
}

/**
 * The member's last channel on this browser, per chapter
 * (`@repo/hooks` `landing-channel.ts` owns the rule that reads it).
 *
 * localStorage, best-effort: a private window, blocked site data or a full
 * quota throws or reads empty, and Chat then opens on the chapter default,
 * else `#general`.
 */
export function readLastChannel(
  userId: string | null | undefined,
  chapterId: string | null | undefined,
  view: ChatView = "channels",
): string | null {
  if (!userId || !chapterId || typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(storageKey(userId, chapterId, view));
  } catch {
    return null;
  }
}

export function writeLastChannel(
  userId: string | null | undefined,
  chapterId: string | null | undefined,
  channelId: string,
  view: ChatView = "channels",
): void {
  if (!userId || !chapterId || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      storageKey(userId, chapterId, view),
      channelId,
    );
  } catch {
    /* Best-effort: the next open falls back to #general. */
  }
}
