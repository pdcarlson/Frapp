"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useFrappClient } from "./use-frapp-client";

export function useAttendance(eventId: string) {
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
  });
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
