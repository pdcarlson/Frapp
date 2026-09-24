/**
 * The local notification that fires when a study session pauses (#1065).
 *
 * `spec/behavior/study-sessions.md` § Anti-Distraction specifies it verbatim:
 *
 * > A local notification fires: "Your study session is paused. Return to Frapp
 * > to resume."
 *
 * C5 built the study screen and deliberately did not build this, because
 * `expo-notifications` was not a dependency and `package.json` is a frozen
 * hotspot. C7 owns the dependency, the Android channel and the primer, so it
 * lands here.
 *
 * ## Local, not remote
 *
 * It never leaves the device: no push token, no APNs/FCM credential, no EAS
 * build. That matters because it means this is the **one part of C7 that
 * actually works in a real build today** — everything token-shaped is blocked
 * on #938. It still needs the native module, so it does nothing in Expo Go.
 *
 * ## Why the id is module state
 *
 * The pause fires as the app backgrounds and the resume fires as it
 * foregrounds, which is a mount boundary the study screen's own state does not
 * reliably survive. Keeping the identifier here means the resume can clear a
 * notice posted by a previous foreground pass. At most one is ever outstanding:
 * a member has one live session.
 *
 * Every call is best-effort. A missing notification is a member who has to open
 * the app to notice; a throw would roll back a pause that actually succeeded.
 */

import { clearLocalNotification, presentLocalNotification } from "./push";

let outstandingId: string | null = null;

/**
 * Bumped **synchronously** by every post and every clear.
 *
 * Posting is asynchronous and the id only exists once it resolves, so a clear
 * issued while a post is in flight would find `outstandingId` still `null`,
 * no-op, and let the notice land afterwards with nothing left to remove it.
 * That is not a race in the usual sense — it happens deterministically on the
 * path that matters most: `study.tsx` fires `void notifyStudyPaused()` and then
 * applies the response synchronously, so a `/pause` that comes back terminal
 * (`PAUSED_EXPIRED`, or a session an officer already closed) clears in the very
 * same tick. The member would be left with "Return to Frapp to resume" pointing
 * at a session that no longer exists, until their next pause.
 *
 * The counter has to be claimed *before* the first `await`, which is the whole
 * subtlety: an earlier version claimed it after awaiting the withdraw, by which
 * time the clear had already come and gone. Claiming it synchronously means a
 * clear that arrives during the post supersedes it, and the post either never
 * happens or withdraws itself.
 */
let generation = 0;

/** Test seam — this is process state, so a spec must be able to reset it. */
export function resetStudyPauseNotificationForTests(): void {
  outstandingId = null;
  generation = 0;
}

/** Removes the outstanding notice, if any. Does **not** bump the generation. */
async function withdraw(): Promise<void> {
  const id = outstandingId;
  if (!id) return;
  outstandingId = null;
  try {
    await clearLocalNotification(id);
  } catch {
    // Already gone, or the module is unavailable. Either way there is nothing
    // left to do and nothing worth telling the member.
  }
}

export async function notifyStudyPaused(): Promise<void> {
  const mine = ++generation;

  // Never stack. A second pause without an intervening resume replaces the
  // notice rather than adding to it.
  await withdraw();
  if (mine !== generation) return;

  let id: string | null = null;
  try {
    id = await presentLocalNotification({
      title: "Study session paused",
      body: "Your study session is paused. Return to Frapp to resume.",
    });
  } catch {
    return;
  }
  if (!id) return;

  if (mine !== generation) {
    // Superseded while the post was in flight — the notice is already unwanted,
    // so withdraw it rather than adopting it.
    try {
      await clearLocalNotification(id);
    } catch {
      // Best effort, same rationale as `withdraw`.
    }
    return;
  }
  outstandingId = id;
}

export async function clearStudyPausedNotification(): Promise<void> {
  // Synchronous, before any await: a post still in flight has to see itself
  // superseded even though this function is about to yield.
  generation += 1;
  await withdraw();
}
