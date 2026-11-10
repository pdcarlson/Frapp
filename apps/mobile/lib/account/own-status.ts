import { useCallback, useEffect, useMemo } from "react";
import { Alert, AppState } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import {
  useOwnStatusAt,
  useUpdateUserSettings,
  useUserSettings,
  userSettingsKey,
  type UpdateUserSettingsBody,
} from "@repo/hooks";
import type { OwnStatus } from "@repo/hooks/member-status";

/**
 * The member's own picked status on the phone (#3845): what the ME button's
 * dot and the status sheet show. The rules (expiry, end times, the end-time
 * timer) are shared with web through `@repo/hooks`.
 *
 * The phone publishes no chapter presence (`spec/behavior/chat/README.md`
 * § Online/offline presence), so unlike web nothing is held back while the
 * status is unknown.
 */

/**
 * How often the open app re-reads the member's status, so a change made on
 * another device shows here within a minute, as web does. Only while the app
 * is in the foreground.
 */
export const STATUS_RESYNC_MS = 60 * 1000;

/**
 * The member's status now, or `null` while the first settings read is in
 * flight. A failed read answers Online, as web's does with no last-known
 * status, so the sheet stays usable: a save is a separate request and may
 * well succeed, and the next re-read corrects the answer.
 */
export function useOwnStatus(): OwnStatus | null {
  const { data, isError } = useUserSettings();
  const source = useMemo(
    () => (data !== undefined ? data : isError ? {} : null),
    [data, isError],
  );
  return useOwnStatusAt(source);
}

/**
 * Keeps the member's status current while the app is open: a re-read every
 * `STATUS_RESYNC_MS` while it is in the foreground. The settings query's
 * five-minute `staleTime` would otherwise hold a status picked on the laptop
 * off the phone for that long. There is deliberately no re-read on the return
 * to the foreground: one fired then lands on the dead sockets iOS leaves a
 * resumed app, which `lib/connection/query-connectivity.ts` (#3747) holds
 * every other refetch back from; the next tick is at most a minute away.
 * Mount once, where the ME button lives.
 */
export function useOwnStatusSync() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const interval = setInterval(() => {
      if (AppState.currentState === "active") {
        void queryClient.invalidateQueries({ queryKey: userSettingsKey });
      }
    }, STATUS_RESYNC_MS);
    return () => clearInterval(interval);
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
