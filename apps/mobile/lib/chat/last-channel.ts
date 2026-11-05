import AsyncStorage from "@react-native-async-storage/async-storage";
import { lastChannelStorageKey } from "@repo/hooks";
import { hasLaunchNotificationTap } from "@/lib/notifications/push";

/**
 * The member's last channel on this phone, and the one-time jump into it when
 * the app opens (owner, 2026-11-05: "Mobile opens up to the last channel you
 * were in. like discord"). The rule for which channel counts is
 * `lastChannelLandingId` in `@repo/hooks`; this file is the phone's storage
 * and the launch bookkeeping. `spec/ui/mobile/navigation.md` § Launch owns the
 * behavior.
 *
 * A token with no `active_chapter_id` is a normal working state (a sole
 * membership resolved server-side), so a missing chapter id still gets a
 * stable key rather than no memory at all.
 */
function key(userId: string, chapterId: string | null): string {
  return lastChannelStorageKey(userId, chapterId ?? "sole");
}

export async function readLastChannel(
  userId: string,
  chapterId: string | null,
): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(key(userId, chapterId));
  } catch {
    return null;
  }
}

export function writeLastChannel(
  userId: string,
  chapterId: string | null,
  channelId: string,
): void {
  AsyncStorage.setItem(key(userId, chapterId), channelId).catch(() => {
    /* Best-effort: the next launch opens on the channel list instead. */
  });
}

/*
  Once per app process. The jump belongs to launch, not to every return to
  chat home: coming back from a thread, a tab, or the background must leave the
  member on the list they went back to.
*/
let launchSettled = false;

/**
 * Called by anything else that decides where launch goes: a notification tap
 * (`use-push-runtime.ts`) opens its own target, and the last channel must not
 * open on top of it.
 */
export function settleChatLaunch(): void {
  launchSettled = true;
}

/**
 * Whether chat home may still make the launch jump. Claims it on `true`, so
 * the jump happens at most once. A tap that launched the app and has not been
 * taken yet also settles it.
 */
export function claimChatLaunch(): boolean {
  if (launchSettled) return false;
  launchSettled = true;
  return !hasLaunchNotificationTap();
}

/** Test seam: a fresh process. */
export function resetChatLaunchForTests(): void {
  launchSettled = false;
}
