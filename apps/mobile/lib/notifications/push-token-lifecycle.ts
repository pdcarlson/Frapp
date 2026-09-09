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
 */

import {
  isAlreadyRegistered,
  narrowPushTokenRow,
  type PushTokenRow,
} from "./push-registration";

export function sessionOwnsPushRegistration(
  isAuthenticated: boolean,
  status: string,
): boolean {
  return isAuthenticated && status === "authenticated";
}

export async function registerCurrentPushToken(deps: {
  isCancelled: () => boolean;
  getToken: () => Promise<string | null>;
  register: (body: { token: string }) => Promise<unknown>;
  remove: (id: string) => Promise<unknown>;
  readStored: () => Promise<PushTokenRow | null>;
  writeStored: (row: PushTokenRow) => Promise<void>;
  warn?: (message: string, error?: unknown) => void;
}): Promise<void> {
  try {
    const token = await deps.getToken();
    if (!token || deps.isCancelled()) return;

    const stored = await deps.readStored();
    if (isAlreadyRegistered(stored, token) || deps.isCancelled()) return;

    const supersededId =
      stored?.id && stored.token !== token ? stored.id : null;

    const created = await deps.register({ token });
    if (deps.isCancelled()) return;

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
      "Push token registration failed; will retry on the next sign-in or token rotation.",
      error,
    );
  }
}

export async function deregisterStoredPushToken(deps: {
  isCancelled: () => boolean;
  readStored: () => Promise<PushTokenRow | null>;
  clearStored: () => Promise<void>;
  remove: (id: string) => Promise<unknown>;
  warn?: (message: string, error?: unknown) => void;
}): Promise<void> {
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
