"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useFrappClient } from "./use-frapp-client";

export interface AttendanceOptions {
  /**
   * Re-read the roster on a timer, in ms, or `false` for no timer (the
   * default). For a screen that shows a count while members arrive, such as
   * mobile's host check-in (s22). A roster change is pushed: web's attendance
   * panel subscribes to the `attendance:<eventId>` realtime ping and
   * invalidates this query. Mobile doesn't subscribe, and there only this
   * client's own check-in and status writes invalidate it, so the timer is
   * how mobile shows another member's check-in for now. The caller turns it
   * off while the screen is out of sight.
   */
  refetchInterval?: number | false;
}

export function useAttendance(
  eventId: string,
  options: AttendanceOptions = {},
) {
  const client = useFrappClient();
  return useQuery({
    queryKey: ["attendance", eventId],
    queryFn: async () => {
      const { data, error } = await client.GET(
        "/v1/events/{eventId}/attendance",
        { params: { path: { eventId } } },
      );
      if (error) throw error;
      return data;
    },
    staleTime: 30_000,
    enabled: !!eventId,
    refetchInterval: options.refetchInterval ?? false,
  });
}

/**
 * How many rows of an attendance roster (`useAttendance`'s data) are a member
 * who is there: `PRESENT` or `LATE`. A member marked LATE did attend, so
 * leaving them out would contradict the roster the same officer can open.
 *
 * `null` when the data isn't a roster (loading, or a failed read), so a caller
 * draws no count rather than a "0 checked in" that isn't true yet. The chat
 * event card on web and mobile and mobile's host check-in screen all count
 * through here.
 */
export function countCheckedIn(data: unknown): number | null {
  if (!Array.isArray(data)) return null;
  return data.reduce((count: number, row: unknown) => {
    if (!row || typeof row !== "object") return count;
    const status = (row as Record<string, unknown>).status;
    return status === "PRESENT" || status === "LATE" ? count + 1 : count;
  }, 0);
}

export interface CheckInVariables {
  eventId: string;
  /** Rotating token read from the host QR (s18). */
  token?: string;
  /** Short code typed off the host screen when the camera fails. */
  manualCode?: string;
  /** Required by the server when the event defines a check-in geofence. */
  lat?: number;
  lng?: number;
}

/**
 * Self check-in.
 *
 * Takes an object rather than a bare `eventId` so the mobile scanner can carry
 * its token and location on the same mutation the chat event card already uses —
 * the server decides which fields a given event requires, so one hook serves the
 * plain, tokenised, and geofenced paths.
 */
export function useCheckIn() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ eventId, ...payload }: CheckInVariables) => {
      const { data, error } = await client.POST(
        "/v1/events/{eventId}/attendance/check-in",
        { params: { path: { eventId } }, body: payload },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, { eventId }) => {
      queryClient.invalidateQueries({ queryKey: ["attendance", eventId] });
    },
  });
}

/**
 * The rotating code for the host display (s22).
 *
 * Officer-only (`events:update`) and 503s where the environment has no signing
 * secret, so callers must render both states. Polled rather than timed off the
 * previous response: the server owns the window boundary, and a client that
 * re-derived it would drift.
 *
 * `staleTime: 0` and no structural sharing of a stale token — a code that is one
 * window old is still redeemable, so a slightly late refetch degrades to "the
 * previous code", never to a dead screen.
 */
export function useMintCheckInToken(eventId: string, enabled = true) {
  const client = useFrappClient();
  return useQuery({
    queryKey: ["attendance", eventId, "check-in-token"],
    queryFn: async () => {
      const { data, error } = await client.GET(
        "/v1/events/{eventId}/attendance/check-in-token",
        { params: { path: { eventId } } },
      );
      if (error) throw error;
      return data;
    },
    enabled: enabled && !!eventId,
    staleTime: 0,
    // Comfortably inside the 30s window so the displayed code is never the one
    // that just aged out of the previous-window grace.
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
    // A 403 (not an officer) or 503 (unconfigured) will not fix itself by
    // asking again on a timer.
    retry: false,
  });
}

export function useUpdateAttendanceStatus() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      eventId,
      userId,
      body,
    }: {
      eventId: string;
      userId: string;
      body: {
        status: "PRESENT" | "EXCUSED" | "ABSENT" | "LATE";
        excuse_reason?: string;
      };
    }) => {
      const { data, error } = await client.PATCH(
        "/v1/events/{eventId}/attendance/{userId}",
        { params: { path: { eventId, userId } }, body },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["attendance", variables.eventId],
      });
    },
  });
}

export function useAutoAbsent() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (eventId: string) => {
      const { data, error } = await client.POST(
        "/v1/events/{eventId}/attendance/auto-absent",
        { params: { path: { eventId } } },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, eventId) => {
      queryClient.invalidateQueries({ queryKey: ["attendance", eventId] });
    },
  });
}
