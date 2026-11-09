import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, AppState } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import {
  useUpdateUserSettings,
  useUserSettings,
  userSettingsKey,
  type UpdateUserSettingsBody,
} from "@repo/hooks";
import {
  nextStatusChangeAt,
  ownStatusAt,
  type OwnStatus,
} from "@repo/hooks/member-status";

/**
 * The member's own picked status on the phone (#3845): what the ME button's
 * dot and the status sheet show. The rules (expiry, end times) are the shared
 * `@repo/hooks/member-status`, the same ones web reads.
 *
 * The phone publishes no chapter presence (`spec/behavior/chat/README.md`
 * § Online/offline presence), so unlike web nothing is held back while the
 * status is unknown: `null` only means "no dot yet".
 */

/**
 * How often the open app re-reads the member's status, so a change made on
 * another device shows here within a minute, as web does. The app only re-reads
 * while it is in the foreground, and once more when it comes back.
 */
export const STATUS_RESYNC_MS = 60 * 1000;

/** `setTimeout` takes at most a signed 32-bit delay; past it, it fires at once. */
const MAX_TIMER_MS = 2_147_483_647;

/**
 * The member's status at the current moment, or `null` until the settings
 * have been read. Re-renders at the next end time, so a DND for 1 hour ends on
 * the ME button an hour later even if nothing refetches.
 */
export function useOwnStatus(): OwnStatus | null {
  const { data } = useUserSettings();
  const [now, setNow] = useState(() => Date.now());

  const own = useMemo(
    () => (data === undefined ? null : ownStatusAt(data, now)),
    [data, now],
  );
  const nextChange = own ? nextStatusChangeAt(own) : null;

  // Measured from the real clock, so an end that passed while the app slept
  // fires at once. `now` is a dependency so a timer cut short by the 32-bit
  // cap re-arms for the rest.
  useEffect(() => {
    if (nextChange === null) return undefined;
    const delay = Math.max(nextChange - Date.now(), 0);
    const capped = delay > MAX_TIMER_MS;
    const timer = setTimeout(
      () => setNow(capped ? Date.now() : Math.max(Date.now(), nextChange)),
      capped ? MAX_TIMER_MS : delay,
    );
    return () => clearTimeout(timer);
  }, [nextChange, now]);

  return own;
}

/**
 * Keeps the member's status current while the app is open: a re-read every
 * `STATUS_RESYNC_MS` in the foreground, and one when the app comes back to
 * the foreground. The settings query's five-minute `staleTime` would otherwise
 * hold a status picked on the laptop off the phone for that long. Mount once,
 * where the ME button lives.
 */
export function useOwnStatusSync() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const refetch = () =>
      void queryClient.invalidateQueries({ queryKey: userSettingsKey });
    const interval = setInterval(() => {
      if (AppState.currentState === "active") refetch();
    }, STATUS_RESYNC_MS);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") refetch();
    });
    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [queryClient]);
}

type StatusBody = Pick<
  UpdateUserSettingsBody,
  "status" | "status_expires_at" | "custom_status" | "custom_status_expires_at"
>;

export const STATUS_SAVE_FAILED = "Couldn't save your status";

/**
 * Save a status or custom line. Optimistic through the shared settings
 * mutation, so the dot moves on the tap; a refused save rolls back and says so.
 */
export function useSaveOwnStatus() {
  const mutation = useUpdateUserSettings();
  const { mutateAsync } = mutation;

  const save = useCallback(
    async (body: StatusBody): Promise<boolean> => {
      try {
        await mutateAsync(body);
        return true;
      } catch {
        Alert.alert(STATUS_SAVE_FAILED, "Try again.");
        return false;
      }
    },
    [mutateAsync],
  );

  return { save, isSaving: mutation.isPending };
}
