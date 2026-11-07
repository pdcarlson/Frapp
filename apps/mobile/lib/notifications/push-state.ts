/**
 * The phone's answer on push, read the one way every surface reads it: s16
 * Settings' switch, the onboarding ask (s03 and chapter setup) and the chat
 * home's reminder. Moved out of `preferences.tsx` so all three agree on what
 * "on" means and on when a prompt can still help, rather than one reading
 * `granted` and missing the Android 13+ case below.
 */

import { getPushPermission, isPushChannelBlocked } from "./push";
import type { PushPermissionStatus } from "./push-types";

/**
 * What the push switch reads: the OS permission, and whether the member has
 * switched off the app's Android push channel (`isPushChannelBlocked()`),
 * which the permission doesn't report.
 */
export type PushState = PushPermissionStatus & { channelBlocked: boolean };

/**
 * Both reads, together, so the switch never pairs a fresh one with a stale
 * other. `null` when there is no module to ask; rejects if either read fails,
 * which the callers treat as unknown.
 */
export async function readPushState(): Promise<PushState | null> {
  const [permission, channelBlocked] = await Promise.all([
    getPushPermission(),
    isPushChannelBlocked(),
  ]);
  return permission ? { ...permission, channelBlocked } : null;
}

/**
 * Whether the OS will show a push: what Settings' switch reports, and what
 * decides whether onboarding and the chat home still ask.
 *
 * `status`, not `granted`. On Android 13+ (`targetSdk` 33 and up)
 * expo-notifications 57 sets `granted` from the POST_NOTIFICATIONS runtime
 * permission alone, and reports the app's notifications being switched off
 * (`areNotificationsEnabled()`) only in `status`. So
 * `{ granted: true, status: "denied" }` is a real answer, and that device
 * shows nothing (`NotificationPermissionsModule.kt`,
 * `getPermissionsWithPromiseImplApi33`). Below Android 13 and on iOS the two
 * fields agree. iOS reports `status: "granted"` only for full authorization
 * (`ExpoNotificationsPermissionsRequester.swift`): a provisional or ephemeral
 * grant reads `"undetermined"`, so the switch is off there and a tap asks for
 * the full prompt.
 *
 * Nor is it on with the app's Android push channel switched off: `status`
 * still reads `"granted"` then, but that channel is where the API's pushes
 * show (`isPushChannelBlocked()`).
 */
export function pushIsOn(push: PushState): boolean {
  return push.status === "granted" && !push.channelBlocked;
}

/**
 * Whether asking would show the OS prompt: nothing granted yet, the OS will
 * still ask, and a grant would be enough. A granted permission whose
 * notifications are blocked (the Android 13+ case above) is not one: Android
 * answers that request at once, with no prompt. Nor is a channel switched
 * off, which no prompt turns back on. Only the OS settings fix those.
 */
export function pushTapAsks(push: PushState): boolean {
  return !push.granted && push.canAskAgain && !push.channelBlocked;
}
