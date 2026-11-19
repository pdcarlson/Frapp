/**
 * Token register / rotate / deregister without React.
 *
 * `use-push-runtime.ts` owns when these run (auth edges + the Expo token
 * listener). This module is the part that has to be right about *what* runs:
 * POST the current Expo token, persist the row id, then DELETE a superseded
 * id. Tests cover that path without mounting the hook.
 *
 * ## Why POST-then-DELETE on rotation, and DELETE-before-clear on sign-out
 *
 * They look contradictory and are not. Sign-out must not leave a row the
 * next sign-in can race against (`use-push-runtime.ts` documents that race at
 * the deregister call). Rotation must not open a window with *no* live token:
 * POST the new value first (idempotent for an unchanged pair), persist, then
 * drop the old id. `NotificationService.registerPushToken` returns the existing
 * row for the same (user, token) pair and creates a new row when the token
 * string changes, so the superseded id is never updated in place.
 *
 * ## Why every register POSTs, even when storage already holds the token (#2617)
 *
 * The stored row is this device's memory of the server, not the server. The
 * API drops rows on its own: `DeviceNotRegistered` receipts prune them, a
 * second account signing in on the same device takes the token over
 * (`registerPushToken` deletes the other user's row), and an account or data
 * wipe cascades them away. A "stored token matches, skip" shortcut never
 * notices any of that, so push stayed dead for the install until a sign-out
 * cleared storage. The POST is idempotent, so it runs on every register.
 */

import { narrowPushTokenRow, type PushTokenRow } from "./push-registration";

/** The `POST /v1/push-tokens` body. */
export type RegisterPushTokenBody = {
  token: string;
  device_name?: string;
  /**
   * What the phone's push switch reads (`pushIsOn()`), so officers can see
   * whose notifications are off (the Directory's "Phone app" filter).
   * Omitted when the read failed, which leaves the stored value as it was.
   */
  notifications_enabled?: boolean;
};

/**
 * The notifications answer the last successful register sent, so a return
 * to the foreground re-registers only when it has changed (the member turned
 * notifications on or off in the OS settings while away). `undefined` until
 * a register with an answer succeeds; cleared on sign-out.
 */
let reportedNotificationsEnabled: boolean | undefined;

export function lastReportedNotificationsEnabled(): boolean | undefined {
  return reportedNotificationsEnabled;
}

/**
 * Whether a return to the foreground should re-register: only once a register
 * has reported an answer, and only when the phone now reads differently. So
 * an ordinary app switch posts nothing, and a build that can't get a token
 * doesn't retry on every switch.
 */
export function shouldReportOnForeground(
  enabled: boolean | undefined,
  reported: boolean | undefined = reportedNotificationsEnabled,
): boolean {
  return (
    enabled !== undefined && reported !== undefined && enabled !== reported
  );
}

/**
 * `getExpoPushTokenAsync` may emit `onDevicePushToken` before it resolves.
 * The listener would then re-enter this function, `getToken` again, and
 * recurse, so a call that finds one in flight returns at once (and asks for
 * the single follow-up below).
 */
let registerInFlight = false;

type RegisterDeps = Parameters<typeof registerCurrentPushToken>[0];

/**
 * A register asked for while one was in flight (a grant on s03 landing during
 * the sign-in register). Run once more when the current one ends, so the grant
 * still counts if the in-flight register fails. Only one follow-up ever runs:
 * a re-entry from inside the follow-up is the recursion the guard exists for.
 */
let rerunDeps: RegisterDeps | null = null;
let isRerun = false;

const permissionGrantedListeners = new Set<() => void>();

/**
 * Subscribes to "the member just granted push permission" (#2617).
 *
 * The auth-edge register runs at sign-in, before the s03 primer or Settings'
 * push switch has asked the OS. Neither platform's token call checks
 * permission (iOS `registerForRemoteNotifications`, Android's FCM token), so
 * that register should already have a row, but nothing proves it on a device.
 * Registering again on the grant takes the question off the table, and costs
 * one idempotent POST. Returns the unsubscribe.
 */
export function onPushPermissionGranted(listener: () => void): () => void {
  permissionGrantedListeners.add(listener);
  return () => {
    permissionGrantedListeners.delete(listener);
  };
}

/** Called by `acceptPrimer()` when the OS reports permission granted. */
export function notifyPushPermissionGranted(): void {
  for (const listener of permissionGrantedListeners) listener();
}

export function sessionOwnsPushRegistration(
  isAuthenticated: boolean,
  status: string,
): boolean {
  return isAuthenticated && status === "authenticated";
}

export async function registerCurrentPushToken(deps: {
  isCancelled: () => boolean;
  getToken: () => Promise<string | null>;
  /**
   * The platform label for the row (`push-device-name.ts`, #4563). Sent on
   * every register so a row stored before the phone sent one gets it filled.
   */
  getDeviceName?: () => string | undefined;
  /** What the phone's push switch reads; `undefined` when it can't tell. */
  getNotificationsEnabled?: () => Promise<boolean | undefined>;
  register: (body: RegisterPushTokenBody) => Promise<unknown>;
  remove: (id: string) => Promise<unknown>;
  readStored: () => Promise<PushTokenRow | null>;
  writeStored: (row: PushTokenRow) => Promise<void>;
  warn?: (message: string, error?: unknown) => void;
}): Promise<void> {
  if (registerInFlight) {
    if (!isRerun) rerunDeps = deps;
    return;
  }
  registerInFlight = true;
  try {
    try {
      const token = await deps.getToken();
      if (!token || deps.isCancelled()) return;

      const stored = await deps.readStored();
      if (deps.isCancelled()) return;

      const supersededId =
        stored?.id && stored.token !== token ? stored.id : null;

      const deviceName = deps.getDeviceName?.();
      const notificationsEnabled = await deps
        .getNotificationsEnabled?.()
        .catch(() => undefined);
      // The read awaited, so a sign-out may have landed meanwhile.
      if (deps.getNotificationsEnabled && deps.isCancelled()) return;
      const body: RegisterPushTokenBody = { token };
      if (deviceName) body.device_name = deviceName;
      if (notificationsEnabled !== undefined) {
        body.notifications_enabled = notificationsEnabled;
      }
      const created = await deps.register(body);
      if (deps.isCancelled()) return;
      if (notificationsEnabled !== undefined) {
        reportedNotificationsEnabled = notificationsEnabled;
      }

      const row = narrowPushTokenRow(created);
      await deps.writeStored(row ?? { id: null, token });
      if (!row?.id) {
        deps.warn?.(
          "Push token registered but its row id could not be read; sign-out will not be able to deregister it.",
        );
      }

      if (supersededId && supersededId !== row?.id) {
        try {
          await deps.remove(supersededId);
        } catch (error) {
          deps.warn?.(
            "Superseded push token row could not be deleted; the old token may keep receiving until it expires.",
            error,
          );
        }
      }
    } catch (error) {
      deps.warn?.(
        "Push token registration failed; will retry on the next launch, sign-in, token rotation or permission change.",
        error,
      );
    }
  } finally {
    registerInFlight = false;
    const next = rerunDeps;
    rerunDeps = null;
    if (next && !isRerun && !next.isCancelled()) {
      isRerun = true;
      try {
        await registerCurrentPushToken(next);
      } finally {
        isRerun = false;
      }
    }
  }
}

export async function deregisterStoredPushToken(deps: {
  isCancelled: () => boolean;
  readStored: () => Promise<PushTokenRow | null>;
  clearStored: () => Promise<void>;
  remove: (id: string) => Promise<unknown>;
  warn?: (message: string, error?: unknown) => void;
}): Promise<void> {
  reportedNotificationsEnabled = undefined;
  const stored = await deps.readStored();
  if (deps.isCancelled()) return;
  if (!stored?.id) {
    await deps.clearStored();
    return;
  }
  try {
    // DELETE **before** clearing storage. The other order looks safer and
    // is not: `registerPushToken` returns the *existing* row for the same
    // user and token, and the Expo token is stable across sign-outs — so a
    // sign-out immediately followed by a sign-in could re-create row X,
    // persist it, and only then have this DELETE land and remove the row
    // the live session depends on, leaving push silently dead for that
    // install until storage is wiped. Deleting first means the worst case
    // is a stale local row, which the next register overwrites.
    await deps.remove(stored.id);
  } catch (error) {
    deps.warn?.(
      "Push token deregistration failed; the server row may outlive the session.",
      error,
    );
  }
  await deps.clearStored();
}
