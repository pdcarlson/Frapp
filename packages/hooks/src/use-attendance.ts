"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  isRetryableFailure,
  serverMessageOf,
  statusOf,
  throwUnlessOk,
} from "@repo/api-sdk";
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
      const result = await client.GET("/v1/events/{eventId}/attendance", {
        params: { path: { eventId } },
      });
      // On the status, not `error` (see `throwUnlessOk`). An empty-bodied 5xx
      // still failed this read before (TanStack rejects a queryFn that
      // returns `undefined`), but with an error that carried no status, so
      // `statusOf` and `isRetryableFailure` couldn't tell what it was.
      throwUnlessOk(result);
      return result.data;
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
      const result = await client.POST(
        "/v1/events/{eventId}/attendance/check-in",
        { params: { path: { eventId } }, body: payload },
      );
      // On the status, not `error`: openapi-fetch returns an empty error body
      // as `undefined` or `""`, so an edge's empty-bodied 502 during a deploy
      // would read as a check-in, and with no outbox the member would leave
      // believing they were on the roster.
      throwUnlessOk(result);
      return result.data;
    },
    onSuccess: (_data, { eventId }) => {
      queryClient.invalidateQueries({ queryKey: ["attendance", eventId] });
    },
  });
}

/**
 * The API's 503 for an environment with no signing secret for check-in codes
 * (`AttendanceService.requireTokenSecret`). Minting a code meets it, and so
 * does every check-in that carries a code, scanned or typed. It has no `code`
 * (`@repo/api-sdk`'s `codeOf`), so the message identifies it;
 * `apps/mobile/lib/events/check-in-outcome.spec.ts` reads it from the API's
 * source so the two can't drift apart in silence.
 */
export const CHECK_IN_CODES_UNCONFIGURED_MESSAGE =
  "Rotating check-in codes are not configured for this environment";

/** Whether a failure is {@link CHECK_IN_CODES_UNCONFIGURED_MESSAGE}'s 503. */
export function isCheckInCodesUnconfigured(error: unknown): boolean {
  return (
    statusOf(error) === 503 &&
    serverMessageOf(error) === CHECK_IN_CODES_UNCONFIGURED_MESSAGE
  );
}

/**
 * Whether a failed check-in or code request may go through when asked again
 * later, for s22's poll and s18's sheet alike.
 *
 * "No real answer" is `@repo/api-sdk`'s `isRetryableFailure`, the one shared
 * rule: no status at all (a dropped connection), a 5xx, or an intermediary's
 * 408/499/460. Two changes to it, both about waiting rather than repeating at
 * once. The rate limit's 429 is added: the shared rule counts it definitive
 * because an immediate repeat is refused too, but it lifts by itself. And the
 * unconfigured 503 is taken out: no amount of asking supplies a missing
 * secret.
 */
export function isTransientCheckInFailure(error: unknown): boolean {
  if (isCheckInCodesUnconfigured(error)) return false;
  return isRetryableFailure(error) || statusOf(error) === 429;
}

/**
 * A moment on this device, read off both of its clocks.
 *
 * Neither clock alone measures how long ago something happened. The wall
 * clock (`Date.now()`) can step: a network time correction or a manual change
 * moves it by seconds or minutes, and a step back would make a code look
 * younger by the size of the step. The monotonic clock (`performance.now()`)
 * never steps, but on Android it stops while the phone sleeps: React Native
 * reads it off `std::chrono::steady_clock`, which there is `CLOCK_MONOTONIC`,
 * so after the screen has been off it reads as if no time had passed.
 * {@link elapsedSince} takes the larger of the two, so either failure can
 * only make a code look older than it is.
 */
export interface DeviceInstant {
  monotonic: number;
  wall: number;
}

export function deviceNow(): DeviceInstant {
  return { monotonic: performance.now(), wall: Date.now() };
}

/** How long ago `since` was: the larger reading (see {@link DeviceInstant}). */
export function elapsedSince(since: DeviceInstant, now: DeviceInstant): number {
  return Math.max(now.monotonic - since.monotonic, now.wall - since.wall);
}

/**
 * What `useMintCheckInToken` resolves to: the server's response, untouched,
 * and when this device sent the request.
 *
 * `requestedAt` is stamped before the request leaves, so it is never later
 * than the mint. The response's `rotatesInMs`, less the time elapsed since
 * `requestedAt`, is what is left of the code's current window, counted on
 * this device with no comparison against the server's clock, which a phone's
 * can be well off. It is never more than the real time left. Receipt time
 * would err the other way, by the response's whole trip.
 */
export interface MintedCheckInTokenResult {
  response: unknown;
  requestedAt: DeviceInstant;
}

/**
 * Until a response says when it rotates, and after a failed request that may
 * go through next time ({@link isTransientCheckInFailure}, or a 401: see
 * {@link checkInTokenRefetchMs}).
 */
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
 * How long to wait before asking for the next code, or `false` for not on a
 * timer: just after the current one rotates; on the fallback poll while there
 * is nothing to time from, after a failure that may go through next time, and
 * after a 401; and not at all after a refusal that won't change by asking (a
 * 403 for a member who isn't an officer, a 404, the unconfigured 503).
 * Exported for the spec; the hook hands it TanStack's query state as a
 * `refetchInterval` function, which is re-read after every fetch and every
 * render.
 *
 * A 401 is polled because here it is most often a sign-in being renewed,
 * not a refusal. The host display is left up while the phone sleeps past the
 * access token's expiry, and on waking the focus refetch races the token's
 * auto-refresh, so the request goes out with the expired token. The renewed
 * token then lands without asking this query again: the query isn't keyed on
 * the token, and a renewal for the same member clears no cache. Without the
 * timer the screen would sit on "Code unavailable" until someone tapped Try
 * again. A real sign-out leaves the tabs for sign-in, so a 401 that won't
 * clear isn't polled for long. Only this poll treats a 401 so:
 * {@link isTransientCheckInFailure}, which s18's sheet reads too, leaves it
 * out.
 */
export function checkInTokenRefetchMs(
  state: {
    data: MintedCheckInTokenResult | undefined;
    status: "pending" | "error" | "success";
    error: unknown;
  },
  now: DeviceInstant,
): number | false {
  // A failed refetch keeps the last data, whose rotation is past: timing off
  // it would ask again every second.
  if (state.status === "error") {
    return isTransientCheckInFailure(state.error) ||
      statusOf(state.error) === 401
      ? CHECK_IN_TOKEN_FALLBACK_POLL_MS
      : false;
  }
  const result = state.data;
  const rotatesInMs = result ? rotatesInMsOf(result.response) : null;
  if (!result || rotatesInMs === null) return CHECK_IN_TOKEN_FALLBACK_POLL_MS;
  return Math.max(
    CHECK_IN_TOKEN_MIN_POLL_MS,
    rotatesInMs +
      CHECK_IN_TOKEN_ROTATION_SLACK_MS -
      elapsedSince(result.requestedAt, now),
  );
}

/**
 * The rotating code for the host display (s22).
 *
 * Officer-only (`events:update`) and 503s where the environment has no signing
 * secret, so callers must render both states. Asked for again half a second
 * after the code rotates (see {@link CHECK_IN_TOKEN_ROTATION_SLACK_MS}), timed
 * off the response's own `rotatesInMs` rather than a fixed poll, so a screen
 * on display shows each new code just after its window opens: about one
 * request per 30s window, plus one each time the screen regains focus. The
 * server still owns the boundary: the client only counts down to the moment
 * the server named, on the device's clocks (see
 * {@link MintedCheckInTokenResult}). A 10s poll stands in while there is no
 * answer to time from, and after a failure that may go through next time or a
 * 401; a refusal stops the timer ({@link checkInTokenRefetchMs}).
 *
 * `staleTime: 0` and no structural sharing of a stale token — a code that is one
 * window old is still redeemable, so a slightly late refetch degrades to "the
 * previous code", never to a dead screen. A failed refetch keeps the last
 * code as `data` beside its error, and s22 goes on drawing it while it still
 * redeems.
 */
export function useMintCheckInToken(eventId: string, enabled = true) {
  const client = useFrappClient();
  return useQuery({
    queryKey: ["attendance", eventId, "check-in-token"],
    queryFn: async (): Promise<MintedCheckInTokenResult> => {
      const requestedAt = deviceNow();
      const result = await client.GET(
        "/v1/events/{eventId}/attendance/check-in-token",
        { params: { path: { eventId } } },
      );
      // On the status, not `error` (see `throwUnlessOk`). An empty-bodied
      // 5xx read as a success would replace the code on screen, which still
      // redeems, with an answer that has no code in it.
      throwUnlessOk(result);
      return { response: result.data, requestedAt };
    },
    enabled: enabled && !!eventId,
    staleTime: 0,
    refetchInterval: (query) => checkInTokenRefetchMs(query.state, deviceNow()),
    refetchOnWindowFocus: true,
    // A 403 (not an officer) or 503 (unconfigured) will not fix itself by
    // asking again, and a transient failure or a 401 is asked again by the
    // fallback poll, not at once.
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
      const result = await client.PATCH(
        "/v1/events/{eventId}/attendance/{userId}",
        { params: { path: { eventId, userId } }, body },
      );
      // On the status, not `error` (see `throwUnlessOk`).
      throwUnlessOk(result);
      return result.data;
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
      const result = await client.POST(
        "/v1/events/{eventId}/attendance/auto-absent",
        { params: { path: { eventId } } },
      );
      // On the status, not `error` (see `throwUnlessOk`).
      throwUnlessOk(result);
      return result.data;
    },
    onSuccess: (_data, eventId) => {
      queryClient.invalidateQueries({ queryKey: ["attendance", eventId] });
    },
  });
}
