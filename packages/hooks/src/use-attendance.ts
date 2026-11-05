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
 * What `useMintCheckInToken` resolves to: the server's response, untouched,
 * and when this device sent the request, on its own clock.
 *
 * `requestedAt` is stamped before the request leaves, so it is never later
 * than the mint. Adding the response's `rotatesInMs` to it gives a rotation
 * time on this device's clock that is never later than the real one, with no
 * comparison against the server's clock, which a phone's can be well off.
 * Receipt time would err the other way, by the response's whole trip.
 */
export interface MintedCheckInTokenResult {
  response: unknown;
  requestedAt: number;
}

/** Until a response says when it rotates, and after a failed request. */
export const CHECK_IN_TOKEN_FALLBACK_POLL_MS = 10_000;
/**
 * How long after the computed rotation to ask again. The computed time is
 * early by the request's trip to the server, so asking exactly then could get
 * the old window's code back. Half a second covers an ordinary trip; a request
 * that still lands early just asks again, {@link CHECK_IN_TOKEN_MIN_POLL_MS}
 * later.
 */
export const CHECK_IN_TOKEN_ROTATION_SLACK_MS = 500;
/** The shortest wait between two mints, so a mistimed answer can't loop. */
export const CHECK_IN_TOKEN_MIN_POLL_MS = 1_000;

/** `rotatesInMs` from a mint response, or `null` when it has none. */
function rotatesInMsOf(response: unknown): number | null {
  if (typeof response !== "object" || response === null) return null;
  const value = (response as { rotatesInMs?: unknown }).rotatesInMs;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * How long to wait before asking for the next code: until just after the
 * current one rotates. Exported for the spec; the hook hands it to TanStack as
 * a `refetchInterval` function, which is re-read after every fetch.
 */
export function checkInTokenRefetchMs(
  result: MintedCheckInTokenResult | undefined,
  failed: boolean,
  now: number,
): number {
  const rotatesInMs = result ? rotatesInMsOf(result.response) : null;
  if (failed || !result || rotatesInMs === null) {
    return CHECK_IN_TOKEN_FALLBACK_POLL_MS;
  }
  return Math.max(
    CHECK_IN_TOKEN_MIN_POLL_MS,
    result.requestedAt + rotatesInMs + CHECK_IN_TOKEN_ROTATION_SLACK_MS - now,
  );
}

/**
 * The rotating code for the host display (s22).
 *
 * Officer-only (`events:update`) and 503s where the environment has no signing
 * secret, so callers must render both states. Asked for again when the code
 * rotates, timed off the response's own `rotatesInMs` rather than a fixed
 * poll, so a screen on display shows each new code as its window opens. The
 * server still owns the boundary: the client only counts down to the moment
 * the server named, on the device's clock (see
 * {@link MintedCheckInTokenResult}). A 10s poll stands in while there is no
 * answer to time from.
 *
 * `staleTime: 0` and no structural sharing of a stale token — a code that is one
 * window old is still redeemable, so a slightly late refetch degrades to "the
 * previous code", never to a dead screen.
 */
export function useMintCheckInToken(eventId: string, enabled = true) {
  const client = useFrappClient();
  return useQuery({
    queryKey: ["attendance", eventId, "check-in-token"],
    queryFn: async (): Promise<MintedCheckInTokenResult> => {
      const requestedAt = Date.now();
      const { data, error } = await client.GET(
        "/v1/events/{eventId}/attendance/check-in-token",
        { params: { path: { eventId } } },
      );
      if (error) throw error;
      return { response: data, requestedAt };
    },
    enabled: enabled && !!eventId,
    staleTime: 0,
    refetchInterval: (query) =>
      checkInTokenRefetchMs(
        query.state.data,
        query.state.status === "error",
        Date.now(),
      ),
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
