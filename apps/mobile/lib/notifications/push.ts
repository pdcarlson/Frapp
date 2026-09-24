import { Platform } from "react-native";
import Constants from "expo-constants";
import { isWebOrExpoGo } from "../expo-go";
import { createIsolatedModule } from "../isolated-module";
import { requireNotifications } from "./push-module";
import type {
  NotificationsModule,
  PushNotificationResponse,
  PushSubscription,
} from "./push-types";

/**
 * Isolation module for `expo-notifications`
 * (`spec/ui/mobile/README.md` § Expo Go, `patterns.md` § Push notifications).
 *
 * Remote push was removed from Expo Go in SDK 53, and the package links native
 * modules at import, so an unguarded import crashes Go at launch. Nothing
 * outside this file may import the package — ESLint `no-restricted-imports`
 * enforces it and names this path in its message. Everything else goes through
 * `isPushAvailable()` and the wrappers below.
 *
 * The loader machinery — the cached attempt, the test seam, the warn-and-cache
 * on a load failure — is `lib/isolated-module.ts`, shared with the three other
 * isolation modules. Only the guard and the platform split behind
 * `./push-module` are this module's own.
 *
 * ## Three things have to be true before a push can arrive
 *
 * The native module has to exist, an EAS `projectId` has to be configured, and
 * the member has to have granted permission. The first two are build facts and
 * are what `isPushAvailable()` answers; the third is a runtime state the primer
 * owns. `getExpoPushTokenAsync()` requires the `projectId` outside Expo Go.
 * `app.json` carries it under `extra.eas.projectId` (#2325), so an installed
 * build passes both checks and Expo Go and web fail the first. Passing them
 * says nothing about APNs/FCM credentials or delivery, which only a device
 * proves (#938). When a check fails, `pushUnavailableReason()` says which one,
 * and a placeholder id is never invented.
 *
 * The in-app notification centre (s14) does not depend on any of this. Push is
 * an enhancement over a history that already renders.
 */

// Keep this handle unexported. `push.spec.ts`'s source-shape guard
// bans a static import with the semicolon-bounded regex
// /^(import|export)[^;]*["']expo-notifications(\/[^"']*)?["']/m,
// and `[^;]` spans newlines —
// so an `export` keyword here would reach the `packageName` string below and
// read as an import that does not exist. The cure a maintainer would reach for
// is loosening that regex, which is the guard that stops a real static import
// from crashing Expo Go at launch behind the suite-wide `vi.mock`.
const notifications = createIsolatedModule<NotificationsModule>({
  packageName: "expo-notifications",
  whenUnavailable:
    "push stays disabled and notifications render from in-app data only.",
  load: requireNotifications,
  isUnavailable: isWebOrExpoGo,
});

/**
 * Test-only seam: vitest executes the real CJS `require`, which `vi.mock`
 * cannot intercept, so specs inject a loader instead.
 */
export const setPushLoaderForTests = notifications.setLoaderForTests;

const loadNotifications = notifications.load;

/**
 * The EAS project id `getExpoPushTokenAsync` needs outside Expo Go.
 *
 * Read from the resolved app config rather than hardcoded, and treated as
 * optional: `app.json` commits it, but a config without it (a fork, or a test
 * that stubs `expo-constants`) has to degrade to "unavailable", not crash.
 */
export function easProjectId(): string | null {
  const extra = Constants.expoConfig?.extra as
    { eas?: { projectId?: unknown } } | undefined;
  // `expoConfig.extra.eas.projectId` is what `eas init` writes to app.json and
  // what Expo's own docs read; `easConfig.projectId` is the same value as EAS
  // Build stamps it into the binary, and is the one that survives when the
  // config is dynamic or `extra` is stripped. Either is the project.
  const candidates: unknown[] = [
    extra?.eas?.projectId,
    Constants.easConfig?.projectId,
  ];
  const id = candidates.find((c) => typeof c === "string" && c.length > 0);
  return typeof id === "string" ? id : null;
}

/** Whether this build can register for and receive a remote push. */
export function isPushAvailable(): boolean {
  return loadNotifications() !== null && easProjectId() !== null;
}

/**
 * Why push is unavailable, or `null` when it is available.
 *
 * Each cause gets its own sentence, because each has a different remedy: Expo
 * Go and web are fixed by installing the real build, a module that failed to
 * load in an installed build is a broken build (the case `isolated-module.ts`
 * warns about), and a missing project id is a deployment setting the member
 * cannot do anything about. `spec/ui/design-system/README.md` §5: "A disabled
 * control with no explanation is its own dead end."
 *
 * Its one reader is Settings (s16), which keeps a push row in every build and
 * states this in place of On/Off. The s03 primer card is not drawn at all when
 * push is unavailable (`primer.ts`, #2299), so it never needs a reason.
 */
export function pushUnavailableReason(): string | null {
  if (loadNotifications() === null) {
    // Both cache `null`. Only the guard tells Expo Go apart from an installed
    // build whose native module threw, and telling that member to install the
    // build they are running would be false.
    if (!isWebOrExpoGo()) {
      return "Notifications couldn't start in this version of the app. You'll still see everything here in the app.";
    }
    return "Notifications need the installed Signet build — Expo Go can't receive them. You'll still see everything here in the app.";
  }
  if (easProjectId() === null) {
    return "Notifications aren't switched on for this build yet. You'll still see everything here in the app.";
  }
  return null;
}

/**
 * Local notifications need the module but **not** the `projectId` — they never
 * leave the device. #1065's study pause notice rides this.
 */
function localOnlyModule(): NotificationsModule | null {
  return loadNotifications();
}

/** The one Android channel this app defines. */
export const ANDROID_CHANNEL_ID = "default";

/**
 * Creates the Android notification channel.
 *
 * **Call this before requesting permission.** On Android 13+ the prompt and
 * delivery behave correctly only when the channel already exists
 * (`patterns.md` § Push notifications, "Android channel before permission") — the ordering is the
 * whole rule, so `requestPushPermission()` calls this itself rather than
 * trusting every caller to remember.
 *
 * A no-op on iOS, where the package returns `null` for channel calls.
 */
export async function ensureAndroidChannel(): Promise<void> {
  const mod = localOnlyModule();
  if (!mod || Platform.OS !== "android") return;
  await mod.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: "Chapter notifications",
    // `AndroidImportance.DEFAULT`. Named here rather than imported: pulling the
    // enum in would import the package (see `push-types.ts`).
    importance: 5,
  });
}

export async function getPushPermission() {
  const mod = localOnlyModule();
  return mod ? mod.getPermissionsAsync() : null;
}

/**
 * Requests OS permission, creating the Android channel first.
 *
 * Only ever called from the primer's "Turn on" — never at launch
 * (`patterns.md` § Push notifications, "Contextual primer, never at launch").
 */
export async function requestPushPermission(): Promise<boolean> {
  const mod = localOnlyModule();
  if (!mod) return false;
  await ensureAndroidChannel();
  const status = await mod.requestPermissionsAsync();
  return status.granted;
}

/** The Expo push token to register, or `null` when this build cannot have one. */
export async function getExpoPushToken(): Promise<string | null> {
  const mod = loadNotifications();
  const projectId = easProjectId();
  if (!mod || !projectId) return null;
  const token = await mod.getExpoPushTokenAsync({ projectId });
  return token.data.length > 0 ? token.data : null;
}

/**
 * The tap that launched the app, read once and then cleared.
 *
 * The clear is not optional: without it the same response is returned on every
 * remount of the handler and the member is re-navigated each time
 * (`patterns.md` § Push notifications, "Cold-start dedup").
 */
export function takeLastNotificationResponse(): PushNotificationResponse | null {
  const mod = localOnlyModule();
  if (!mod) return null;
  const response = mod.getLastNotificationResponse();
  if (response) mod.clearLastNotificationResponse();
  return response;
}

export function addNotificationResponseListener(
  listener: (response: PushNotificationResponse) => void,
): PushSubscription | null {
  const mod = localOnlyModule();
  return mod ? mod.addNotificationResponseReceivedListener(listener) : null;
}

/**
 * Mid-session Expo / APNs / FCM token rotation.
 *
 * The native listener hands us a device token. We swallow it: registering
 * that value would bypass Expo's push service, and calling
 * `getDevicePushTokenAsync` from inside the listener can re-enter it. The
 * hook re-reads `getExpoPushToken()` instead.
 *
 * Needs the EAS `projectId` (same as `getExpoPushToken`), not merely the
 * module — a rotation we cannot register is not worth observing.
 */
export function addPushTokenListener(
  listener: () => void,
): PushSubscription | null {
  const mod = loadNotifications();
  const projectId = easProjectId();
  if (!mod || !projectId) return null;
  return mod.addPushTokenListener(() => {
    listener();
  });
}

/** Presents a local notification immediately. Returns its id, or `null`. */
export async function presentLocalNotification(input: {
  title: string;
  body?: string;
}): Promise<string | null> {
  const mod = localOnlyModule();
  if (!mod) return null;
  return mod.scheduleNotificationAsync({
    content: { title: input.title, body: input.body },
    trigger: null,
  });
}

/**
 * Clears a local notification, whether or not it has already been delivered.
 *
 * Both calls are needed and neither is redundant: `presentLocalNotification`
 * schedules with `trigger: null`, which delivers immediately, so the tray copy
 * is removed by `dismissNotificationAsync` — `cancelScheduledNotificationAsync`
 * only cancels something still pending. The cancel is kept for the narrow race
 * where the OS has not yet delivered. Both are best-effort: a stale notice is a
 * cosmetic failure and must never break the transition that triggered it.
 */
export async function clearLocalNotification(identifier: string) {
  const mod = localOnlyModule();
  if (!mod) return;
  await Promise.allSettled([
    mod.cancelScheduledNotificationAsync(identifier),
    mod.dismissNotificationAsync(identifier),
  ]);
}

/**
 * Shows notifications while the app is foregrounded.
 *
 * Without a handler the OS suppresses them in-app, which reads as "push is
 * broken" to anyone testing with the app open. `shouldShowAlert` was split into
 * `shouldShowBanner` / `shouldShowList` in a recent SDK; both are set.
 */
export function configureForegroundPresentation(): void {
  const mod = localOnlyModule();
  if (!mod) return;
  mod.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

/**
 * Sets the app icon badge. Like `ensureAndroidChannel`, this needs only the
 * module, never the EAS `projectId` — the badge is a device-local OS call, not
 * a remote push, so it works in a plain dev build with no project provisioned.
 * A no-op wherever the module can't load (web, Expo Go).
 */
export async function setBadgeCount(count: number): Promise<void> {
  const mod = localOnlyModule();
  if (!mod) return;
  await mod.setBadgeCountAsync(Math.max(0, count));
}
