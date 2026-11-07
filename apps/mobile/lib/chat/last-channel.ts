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
  Once per app process, and only at launch. The jump belongs to launch, not to
  every return to chat home: coming back from a thread, a tab, or the
  background must leave the member on the list they went back to.

  "At launch" is a window from when this module loads (the push runtime
  imports it from the root layout, so that is app start). A list that only
  answers after it (offline, a slow or failed first fetch), or a chat home that
  first mounts later (the app launched into another tab, and tabs mount
  lazily), would otherwise pull the member out of whatever they had moved on
  to. Chat home also settles it when it loses focus.
*/
const LAUNCH_WINDOW_MS = 10_000;
let launchStartedAt = Date.now();
let launchSettled = false;

/**
 * Called by anything else that decides where launch goes: a notification tap
 * (`use-push-runtime.ts`) opens its own target, and the member leaving chat
 * home has chosen somewhere else. The last channel must not open on top.
 */
export function settleChatLaunch(): void {
  launchSettled = true;
}

/**
 * Whether chat home may still make the launch jump. Claims it on `true`, so
 * the jump happens at most once. Past the launch window, or with a tap that
 * launched the app and has not been taken yet, it settles without jumping.
 */
export function claimChatLaunch(now: number = Date.now()): boolean {
  if (launchSettled) return false;
  launchSettled = true;
  if (now - launchStartedAt > LAUNCH_WINDOW_MS) return false;
  return !hasLaunchNotificationTap();
}

/**
 * Whether the launch jump may still happen, without claiming it. Chat home
 * holds its list behind the skeleton while this is true, so the list never
 * flashes before the last channel opens over it (owner, 2026-11-07).
 */
export function chatLaunchOpen(now: number = Date.now()): boolean {
  return (
    !launchSettled &&
    now - launchStartedAt <= LAUNCH_WINDOW_MS &&
    !hasLaunchNotificationTap()
  );
}

/** How long the launch window has left, for a hold that must not outlast it. */
export function chatLaunchWindowLeftMs(now: number = Date.now()): number {
  return Math.max(0, launchStartedAt + LAUNCH_WINDOW_MS - now);
}

/** Test seam: a fresh process, launched at `startedAt`. */
export function resetChatLaunchForTests(startedAt: number = Date.now()): void {
  launchSettled = false;
  launchStartedAt = startedAt;
}
