"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
} from "@/lib/realtime/member-status";
import { useToast } from "@/lib/hooks/use-toast";

/**
 * Another tab of the same browser saved a status. Each tab holds its own
 * settings cache (and its own presence entry), so without this a second tab
 * would keep publishing the old status: a member who picks Invisible in one
 * tab would still show Online from the other until its cache went stale.
 */
const STATUS_CHANNEL = "frapp:member-status";

/** `setTimeout` takes at most a signed 32-bit delay; past it, it fires at once. */
const MAX_TIMER_MS = 2_147_483_647;

/**
 * The viewer's own picked status, expiry applied, or `null` until their
 * settings have loaded. `null` is what holds presence back on load (see
 * `useChapterPresence`'s `own`).
 *
 * Re-renders at the next end time, so a DND for 1 hour ends on screen and on
 * the wire an hour later even if nothing refetches.
 */
export function useOwnStatus(): OwnStatus | null {
  const settings = useUserSettings();
  const queryClient = useQueryClient();
  const [now, setNow] = useState(() => Date.now());

  const data = settings.data;
  const own = useMemo(
    () => (data === undefined ? null : ownStatusAt(data, now)),
    [data, now],
  );
  const nextChange = own ? nextStatusChangeAt(own) : null;

  // The delay is measured from the real clock, not from `now`, so an end time
  // that has already passed (a tab woken from sleep) fires at once.
  useEffect(() => {
    if (nextChange === null) return undefined;
    const timer = setTimeout(
      // Never earlier than the end itself: a timer that fired a millisecond
      // early would leave `nextChange` unchanged, and this effect would not
      // run again to schedule another.
      () => setNow(Math.max(Date.now(), nextChange)),
      Math.min(Math.max(nextChange - Date.now(), 0), MAX_TIMER_MS),
    );
    return () => clearTimeout(timer);
  }, [nextChange]);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return undefined;
    const channel = new BroadcastChannel(STATUS_CHANNEL);
    channel.onmessage = () => {
      void queryClient.invalidateQueries({ queryKey: userSettingsKey });
    };
    return () => channel.close();
  }, [queryClient]);

  return own;
}

type StatusBody = Pick<
  UpdateUserSettingsBody,
  "status" | "status_expires_at" | "custom_status" | "custom_status_expires_at"
>;

/**
 * Save a status or custom line. Optimistic (the shared settings mutation), so
 * the dot and the chapter's view move on the click; a refused save rolls back
 * and says so.
 */
export function useSaveOwnStatus() {
  const mutation = useUpdateUserSettings();
  const { toast } = useToast();
  const { mutateAsync } = mutation;

  const save = useCallback(
    async (body: StatusBody): Promise<boolean> => {
      try {
        await mutateAsync(body);
      } catch {
        toast({
          variant: "destructive",
          description: "Couldn't save your status. Try again.",
        });
        return false;
      }
      if (typeof BroadcastChannel !== "undefined") {
        const channel = new BroadcastChannel(STATUS_CHANNEL);
        channel.postMessage("saved");
        channel.close();
      }
      return true;
    },
    [mutateAsync, toast],
  );

  return { save, isSaving: mutation.isPending };
}
