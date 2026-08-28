/**
 * A structural type for the slice of `expo-notifications` this app touches,
 * rather than `typeof import("expo-notifications")`.
 *
 * The `typeof import(...)` form puts the package in Metro's dependency graph
 * from a *type* position, which defeats the platform split in `push-module.ts`
 * — the web bundle would pull it back in and `expo export --platform web` would
 * die before any runtime guard could run. `lib/payments/stripe-types.ts` learned
 * this the same way; the rule is recorded in `spec/ui/mobile/README.md`.
 *
 * ## `getDevicePushTokenAsync` is deliberately absent
 *
 * `spec/ui/mobile/patterns.md` § Push notifications ends with "Never call
 * `getDevicePushTokenAsync` inside the token listener" — the listener fires on
 * token changes, and fetching a token from inside it can re-trigger the
 * listener and loop. A comment saying so is only as durable as the next reader.
 * Leaving the function off this type makes the call unwriteable: nothing in the
 * app can reach it, because the app's only handle on the package is this shape.
 *
 * The app has no use for it either. Delivery goes through Expo's push service
 * (`apps/api/src/infrastructure/notifications/expo-push.provider.ts` filters with
 * `Expo.isExpoPushToken`), so the token we register is the **Expo** token, not
 * the raw APNs/FCM one.
 */

/** `PermissionResponse` from `expo-modules-core`, narrowed to what we read. */
export interface PushPermissionStatus {
  granted: boolean;
  canAskAgain: boolean;
  status: string;
}

/**
 * `data` is `unknown`, not `Record<string, string>` as the package declares it.
 *
 * The declared type is wrong in the direction that matters here: every payload
 * this app receives carries a nested `target` object
 * (`spec/behavior/notifications.md` § Deep Linking), which is not a string. The
 * readers in `targets.ts` narrow from `unknown` anyway, so typing it honestly
 * costs nothing and stops a `data.target.screen` that would compile and be
 * `undefined` at runtime.
 */
export interface PushNotificationContent {
  title: string | null;
  body: string | null;
  data: unknown;
}

export interface PushNotificationResponse {
  actionIdentifier: string;
  notification: {
    date: number;
    request: {
      identifier: string;
      content: PushNotificationContent;
    };
  };
}

export interface PushSubscription {
  remove(): void;
}

/**
 * Android channel input. `importance` is the numeric value of the package's
 * `AndroidImportance` enum — importing the enum would import the package, which
 * is the whole thing this file exists to avoid. `AndroidImportance.DEFAULT` is
 * `5` and `HIGH` is `6`; `push.ts` names them at the call site.
 */
export interface PushChannelInput {
  name: string;
  importance: number;
  sound?: string | null;
  vibrationPattern?: number[];
  lightColor?: string;
}

export interface PushScheduleRequest {
  content: {
    title: string;
    body?: string;
    data?: Record<string, unknown>;
    sound?: string | null;
  };
  /** `null` presents immediately. */
  trigger: null;
}

export interface NotificationsModule {
  setNotificationChannelAsync(
    channelId: string,
    channel: PushChannelInput,
  ): Promise<unknown>;
  getPermissionsAsync(): Promise<PushPermissionStatus>;
  requestPermissionsAsync(): Promise<PushPermissionStatus>;
  getExpoPushTokenAsync(options?: {
    projectId?: string;
  }): Promise<{ type: string; data: string }>;
  /**
   * The synchronous pair. SDK 57 deprecated `getLastNotificationResponseAsync`
   * and `clearLastNotificationResponseAsync` — the names `patterns.md` was
   * written against, back when the epic targeted SDK 56. Verified against the
   * installed `expo-notifications@57.0.12` type declarations, and the spec has
   * been corrected rather than left naming a deprecated API.
   */
  getLastNotificationResponse(): PushNotificationResponse | null;
  clearLastNotificationResponse(): void;
  addNotificationResponseReceivedListener(
    listener: (response: PushNotificationResponse) => void,
  ): PushSubscription;
  scheduleNotificationAsync(request: PushScheduleRequest): Promise<string>;
  cancelScheduledNotificationAsync(identifier: string): Promise<void>;
  dismissNotificationAsync(identifier: string): Promise<void>;
  setNotificationHandler(handler: unknown): void;
}
