"use client";

import { useCallback, useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useOwnStatusAt,
  useUpdateUserSettings,
  useUserSettings,
  userSettingsKey,
  type UpdateUserSettingsBody,
} from "@repo/hooks";
import {
  type MemberStatusSettings,
  type OwnStatus,
} from "@repo/hooks/member-status";
import { useFrappUser } from "@/lib/auth/use-frapp-user";
import { useToast } from "@/lib/hooks/use-toast";

/**
 * Another tab of the same browser saved a status. Each tab holds its own
 * settings cache (and its own presence entry), so without this a second tab
 * would keep publishing the old status: a member who picks Invisible in one
 * tab would still show Online from the other.
 */
const STATUS_CHANNEL = "frapp:member-status";

/** Identifies this tab's own posts, which its own listener ignores. */
const TAB_ID =
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : String(Math.random());

/**
 * How often an open, visible dashboard re-reads the member's status, so a
 * change made on another device (which no `BroadcastChannel` reaches) is
 * picked up within this long. One small `GET /v1/settings` a minute per
 * visible tab; a hidden tab waits until it is shown, and re-reads then.
 */
export const STATUS_RESYNC_MS = 60 * 1000;

/** The last settings this browser saw for a member, for a failed read. */
const lastKnownKey = (userId: string) => `frapp:own-status:${userId}`;

function readLastKnown(userId: string | null): MemberStatusSettings | null {
  if (!userId) return null;
  try {
    const raw = window.localStorage.getItem(lastKnownKey(userId));
    return raw ? (JSON.parse(raw) as MemberStatusSettings) : null;
  } catch {
    return null;
  }
}

function writeLastKnown(userId: string, settings: MemberStatusSettings) {
  try {
    window.localStorage.setItem(
      lastKnownKey(userId),
      JSON.stringify({
        status: settings.status ?? null,
        status_expires_at: settings.status_expires_at ?? null,
        custom_status: settings.custom_status ?? null,
        custom_status_expires_at: settings.custom_status_expires_at ?? null,
      }),
    );
  } catch {
    // Storage blocked or full: the fallback below is a convenience only.
  }
}

/**
 * The viewer's own picked status, expiry applied, or `null` until it is known.
 * `null` is what holds presence back on load (see `useChapterPresence`'s
 * `own`), so a saved Invisible never flashes Online.
 *
 * **A failed settings read does not hide the member.** Presence must not
 * depend on API health (the provider gates on the link for the same reason).
 * So once the read has failed, the answer is the status this browser last saw
 * for the member, and with none, automatic (Online). The cost: a member who
 * went Invisible on another device, on a browser that never saw it, shows
 * Online until the read recovers, which the periodic re-read retries.
 *
 * Re-renders at the next end time (`useOwnStatusAt`, shared with mobile), so a
 * DND for 1 hour ends on screen and on the wire an hour later even if nothing
 * refetches.
 */
export function useOwnStatus(): OwnStatus | null {
  const settings = useUserSettings();
  const { userId } = useFrappUser();

  const data = settings.data;
  const failed = data === undefined && settings.isError;
  const source = useMemo<MemberStatusSettings | null>(() => {
    if (data !== undefined) return data;
    if (failed) return readLastKnown(userId ?? null) ?? {};
    return null;
  }, [data, failed, userId]);

  useEffect(() => {
    if (data !== undefined && userId) writeLastKnown(userId, data);
  }, [data, userId]);

  return useOwnStatusAt(source);
}

/**
 * Keeps this tab's copy of the member's status current. Mounted once, by
 * `ChapterPresenceProvider`, since one listener per tab is enough:
 *
 *   - another tab of this browser saving a status refetches here at once;
 *   - a visible tab re-reads every `STATUS_RESYNC_MS`, and a tab coming back
 *     into view re-reads then, which is how another *device*'s change arrives.
 */
export function useOwnStatusSync() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const refetch = () =>
      void queryClient.invalidateQueries({ queryKey: userSettingsKey });

    let channel: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== "undefined") {
      channel = new BroadcastChannel(STATUS_CHANNEL);
      channel.onmessage = (event: MessageEvent) => {
        if (event.data !== TAB_ID) refetch();
      };
    }

    const interval = setInterval(() => {
      if (document.visibilityState === "visible") refetch();
    }, STATUS_RESYNC_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") refetch();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      channel?.close();
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [queryClient]);
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
        channel.postMessage(TAB_ID);
        channel.close();
      }
      return true;
    },
    [mutateAsync, toast],
  );

  return { save, isSaving: mutation.isPending };
}
