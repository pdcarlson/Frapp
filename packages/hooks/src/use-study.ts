"use client";

import {
  type QueryClient,
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";
import { invalidatePointReads } from "./use-points";

/**
 * The chapter's study zones.
 *
 * `options.enabled` exists because the route is guarded twice over —
 * `members:view` plus `@RequireModule('geofences')` — so a surface that only
 * shows zones to some members should not fire a request the rest will get a
 * 403 for. The same reasoning `host-check-in.tsx` records for its
 * officer-gated reads.
 */
export function useGeofences(options?: { enabled?: boolean }) {
  const client = useFrappClient();
  // Chapter-scoped despite taking no chapter argument: the route resolves it
  // from the request header, so a bare `["geofences"]` key serves one chapter's
  // zones under another after a switch.
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: ["geofences", chapterId],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/geofences");
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
    enabled: options?.enabled ?? true,
  });
}

export function useStudySessions() {
  const client = useFrappClient();
  // Chapter-scoped despite taking no chapter argument, for the same reason
  // `useGeofences` above is: the route resolves the chapter from the request
  // header, so a bare `["study-sessions"]` key serves one chapter's sessions
  // under another after a switch. Both apps clear the whole cache on a chapter
  // switch (web's provider, and mobile's since #1042), so the key is defense in
  // depth, not the only guard.
  //
  // Deliberately **not** `enabled: !!chapterId`: the claim is absent with no
  // membership and during a hook-off incident, and `ChapterGuard` resolves a
  // sole membership server-side, so gating on the claim would blank the screen
  // for those users instead of scoping it.
  //
  // Which means the scoping above is **correct but inert** whenever the claim
  // is missing: the segment is `null`, so it cannot separate two chapters.
  // It works as soon as the token carries a claim.
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: ["study-sessions", chapterId],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/study-sessions");
      if (error) throw error;
      return data;
    },
    staleTime: 30_000,
  });
}

export function useCreateGeofence() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["geofences", "create-geofence"],
    mutationFn: async (body: {
      name: string;
      /** An outline's corners or a circle, never both (the API refuses both). */
      coordinates?: { lat: number; lng: number }[];
      circle?: { lat: number; lng: number; radius_m: number };
      is_active: boolean;
      minutes_per_point: number;
      points_per_interval: number;
      min_session_minutes: number;
      pause_grace_minutes: number;
    }) => {
      const { data, error } = await client.POST("/v1/geofences", { body });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["geofences"] });
    },
  });
}

export function useUpdateGeofence() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["geofences", "update-geofence"],
    mutationFn: async ({
      id,
      body,
    }: {
      id: string;
      body: {
        name?: string;
        coordinates?: { lat: number; lng: number }[];
        circle?: { lat: number; lng: number; radius_m: number };
        is_active?: boolean;
        minutes_per_point?: number;
        points_per_interval?: number;
        min_session_minutes?: number;
        pause_grace_minutes?: number;
      };
    }) => {
      const { data, error } = await client.PATCH("/v1/geofences/{id}", {
        params: { path: { id } },
        body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["geofences"] });
    },
  });
}

export function useDeleteGeofence() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["geofences", "delete-geofence"],
    mutationFn: async (id: string) => {
      const { data, error } = await client.DELETE("/v1/geofences/{id}", {
        params: { path: { id } },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["geofences"] });
    },
  });
}

export function useStartStudySession() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["study-sessions", "start-study-session"],
    mutationFn: async (body: {
      geofence_id: string;
      lat: number;
      lng: number;
    }) => {
      const { data, error } = await client.POST("/v1/study-sessions/start", {
        body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["study-sessions"] });
      // Start first settles a previous session left paused past its grace
      // window, which awards its minutes; the response is the new session,
      // so nothing in it says that happened.
      void invalidatePointReads(queryClient);
    },
  });
}

/**
 * True when a study write's response is a session that is over. A heartbeat,
 * pause or resume can end the session server-side (grace elapsed, out of the
 * zone, stale, bad GPS), and the response is the only signal: it arrives as a
 * 2xx carrying the closed row, not as an error.
 */
function isEndedStudySession(result: unknown): boolean {
  if (!result || typeof result !== "object") return false;
  const status = (result as { status?: unknown }).status;
  return typeof status === "string" && status !== "ACTIVE";
}

/**
 * After a write that may have closed the session: refresh the session list so
 * a cached ACTIVE row can't restore a dead timer on the next mount, and the
 * points reads, since PAUSED_EXPIRED awards the foreground minutes.
 */
function refreshIfEnded(queryClient: QueryClient, result: unknown) {
  if (!isEndedStudySession(result)) return;
  void queryClient.invalidateQueries({ queryKey: ["study-sessions"] });
  void invalidatePointReads(queryClient);
}

export function useStudyHeartbeat() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["study-sessions", "study-heartbeat"],
    mutationFn: async (body: {
      lat: number;
      lng: number;
      /** GPS accuracy in meters for this fix. Omit when the device did not report one. */
      accuracy_meters?: number;
    }) => {
      const { data, error } = await client.POST(
        "/v1/study-sessions/heartbeat",
        { body },
      );
      if (error) throw error;
      return data;
    },
    // A routine heartbeat on an ACTIVE session changes nothing a list shows,
    // so only an ended session triggers a refresh.
    onSuccess: (data) => refreshIfEnded(queryClient, data),
  });
}

/**
 * Tell the server the session went to the background. Foreground minutes stop
 * accruing at this instant and the grace clock starts; the session auto-expires
 * as PAUSED_EXPIRED if `/resume` doesn't arrive within the zone's grace window.
 */
export function usePauseStudySession() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["study-sessions", "pause-study-session"],
    mutationFn: async () => {
      const { data, error } = await client.POST("/v1/study-sessions/pause");
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["study-sessions"] });
      // A pause past the grace window settles as PAUSED_EXPIRED and awards
      // the foreground minutes.
      if (isEndedStudySession(data)) void invalidatePointReads(queryClient);
    },
  });
}

/**
 * Return-to-foreground signal. Carries coordinates because the member may have
 * left the study zone while away and the next heartbeat is up to five minutes
 * out.
 */
export function useResumeStudySession() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["study-sessions", "resume-study-session"],
    mutationFn: async (body: { lat: number; lng: number }) => {
      const { data, error } = await client.POST("/v1/study-sessions/resume", {
        body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["study-sessions"] });
      void invalidatePointReads(queryClient);
    },
  });
}

export function useStopStudySession() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["study-sessions", "stop-study-session"],
    mutationFn: async () => {
      const { data, error } = await client.POST("/v1/study-sessions/stop");
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["study-sessions"] });
      void invalidatePointReads(queryClient);
    },
  });
}
