"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { components } from "@repo/api-sdk";
import { useFrappClient } from "./use-frapp-client";

/**
 * The newest What's new entry any of the viewer's devices has shown (#4043),
 * for both apps' What's new hosts. A device that would open What's new by
 * itself asks this first (`accountHasSeenNewest` in `@repo/validation`): when
 * the account has seen the newest entry, it marks its own What's new entry
 * instead of opening the notes a second time.
 */
export type WhatsNewSeen = components["schemas"]["WhatsNewSeenDto"];

/** Under the viewer's `["user", "me"]`, which profile edits match exactly. */
export const whatsNewSeenQueryKey = () => ["user", "me", "whats-new"] as const;

/**
 * How long a host waits for the account before it decides on the device's
 * marker alone, as it did before #4043. A slow network delays What's new by
 * this much at most.
 */
export const WHATS_NEW_ACCOUNT_WAIT_MS = 4000;

export interface AccountWhatsNewSeen {
  /** True once the answer is in, failed, is paused offline, or took too long. */
  readonly settled: boolean;
  /**
   * The account's version, `null` when no device has recorded one, or
   * `undefined` when it couldn't be read: the device then goes by its own
   * marker.
   */
  readonly seen: string | null | undefined;
}

export function useAccountWhatsNewSeen(options?: {
  enabled?: boolean;
}): AccountWhatsNewSeen {
  const client = useFrappClient();
  const enabled = options?.enabled ?? true;
  const query = useQuery({
    queryKey: whatsNewSeenQueryKey(),
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/users/me/whats-new");
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
    retry: 1,
    enabled,
  });
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    const timer = setTimeout(() => setWaited(true), WHATS_NEW_ACCOUNT_WAIT_MS);
    return () => clearTimeout(timer);
  }, [enabled]);
  const known = query.status === "success";
  return {
    settled:
      known ||
      query.status === "error" ||
      query.fetchStatus === "paused" ||
      waited,
    seen: known ? (query.data?.seen_version ?? null) : undefined,
  };
}

/**
 * Tells the account a device showed What's new up to `version`. Best effort:
 * a failure only means another device may open the same notes once, as it
 * did before #4043, so it is retried briefly and never surfaced.
 */
export function useRecordWhatsNewSeen() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (version: string) => {
      const { data, error } = await client.PUT("/v1/users/me/whats-new", {
        body: { seen_version: version },
      });
      if (error) throw error;
      return data;
    },
    retry: 2,
    onSuccess: (data) => {
      queryClient.setQueryData(whatsNewSeenQueryKey(), data);
    },
  });
}
