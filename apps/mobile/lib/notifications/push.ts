import { Platform } from "react-native";
import Constants, { ExecutionEnvironment } from "expo-constants";
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
 * Modelled on `lib/payments/stripe.ts`, which solved the identical problem for
 * `@stripe/stripe-react-native`: the guard read inside the function rather than
 * at module scope, the test seam, and the platform split behind
 * `./push-module` all come from there.
 *
 * ## Three things have to be true before a push can arrive
 *
 * The native module has to exist, an EAS `projectId` has to be configured, and
 * the member has to have granted permission. The first two are build facts and
 * are what `isPushAvailable()` answers; the third is a runtime state the primer
 * owns. `getExpoPushTokenAsync()` requires the `projectId` outside Expo Go, and
 * **no EAS project exists yet** (#938 is open and `[human]`), so today this
 * returns false in every build that can be produced. That is reported, not
 * papered over: `pushUnavailableReason()` says which of the two is missing, and
 * a placeholder id is never invented.
 *
 * The in-app notification centre (s14) does not depend on any of this. Push is
 * an enhancement over a history that already renders.
 */

/** `undefined` = not yet attempted; `null` = attempted and unavailable. */
let cachedModule: NotificationsModule | null | undefined;

const defaultLoader = (): NotificationsModule | null => requireNotifications();

let loader = defaultLoader;

/**
 * Test-only seam: vitest executes the real CJS `require`, which `vi.mock`
 * cannot intercept, so specs inject a loader instead.
 */
export function setPushLoaderForTests(
  next: (() => NotificationsModule | null) | null,
) {
  loader = next ?? defaultLoader;
  cachedModule = undefined;
}

function loadNotifications(): NotificationsModule | null {
  if (cachedModule !== undefined) return cachedModule;

  // Belt and braces. `push-module.ts` already returns null on web, so this
  // cannot be the thing that saves the export — but it makes the intent legible
  // at the one place a reader looks, and it is simply true: there is no web
  // target for this app's push.
  if (Platform.OS === "web") {
    cachedModule = null;
    return cachedModule;
  }

  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) {
    cachedModule = null;
    return cachedModule;
  }

  try {
    cachedModule = loader();
  } catch (error) {
    // Outside Expo Go the module is expected to exist, so a load failure is a
    // real linking problem (a dev client built before this package landed), not
    // the Go fallback wearing its clothes.
    console.warn(
      "expo-notifications failed to load; push stays disabled and notifications render from in-app data only.",
      error,
    );
    cachedModule = null;
  }

  return cachedModule;
}

/**
 * The EAS project id `getExpoPushTokenAsync` needs outside Expo Go.
 *
 * Read from the resolved app config rather than hardcoded, and treated as
 * optional for the same reason `publishableKey()` is: local dev, CI and Expo Go
 * all run without it and none of them can receive a push anyway.
 */
export function easProjectId(): string | null {
  const extra = Constants.expoConfig?.extra as
    { eas?: { projectId?: unknown } } | undefined;
  const id = extra?.eas?.projectId;
  return typeof id === "string" && id.length > 0 ? id : null;
}

/** Whether this build can register for and receive a remote push. */
export function isPushAvailable(): boolean {
  return loadNotifications() !== null && easProjectId() !== null;
}

/**
 * Why push is unavailable, or `null` when it is available.
 *
 * The two causes need different sentences: one is fixed by installing a real
 * build, the other is a deployment configuration the member cannot do anything
 * about. `spec/ui/design-system/components.md` §5 — "A disabled control with no
 * explanation is its own dead end."
 */
export function pushUnavailableReason(): string | null {
  if (loadNotifications() === null) {
    return "Notifications need the installed Frapp build — Expo Go can't receive them. You'll still see everything here in the app.";
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
 * (`patterns.md` § Push notifications, first bullet) — the ordering is the
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
 * (`patterns.md` § Push notifications, second bullet).
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
 * (`patterns.md` § Push notifications, third bullet).
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
