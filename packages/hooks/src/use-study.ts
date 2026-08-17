"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";

/**
 * The chapter's study zones.
 *
 * `options.enabled` exists because the route is guarded twice over —
 * `members:view` plus `@RequireModule('geofences')` — so a surface that only
 * shows zones to some members should not fire a request the rest will get a
 * 403 for. Same shape as `usePolls`, and the same reasoning
 * `host-check-in.tsx` records for its officer-gated reads.
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
  return useQuery({
    queryKey: ["study-sessions"],
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
    mutationFn: async (body: {
      name: string;
      coordinates: { lat: number; lng: number }[];
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
    mutationFn: async ({
      id,
      body,
    }: {
      id: string;
      body: {
        name?: string;
        coordinates?: { lat: number; lng: number }[];
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
    },
  });
}

export function useStudyHeartbeat() {
  const client = useFrappClient();
  return useMutation({
    mutationFn: async (body: { lat: number; lng: number }) => {
      const { data, error } = await client.POST(
        "/v1/study-sessions/heartbeat",
        { body },
      );
      if (error) throw error;
      return data;
    },
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
    mutationFn: async () => {
      const { data, error } = await client.POST("/v1/study-sessions/pause");
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["study-sessions"] });
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
    mutationFn: async (body: { lat: number; lng: number }) => {
      const { data, error } = await client.POST("/v1/study-sessions/resume", {
        body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["study-sessions"] });
      queryClient.invalidateQueries({ queryKey: ["points"] });
    },
  });
}

export function useStopStudySession() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await client.POST("/v1/study-sessions/stop");
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["study-sessions"] });
      queryClient.invalidateQueries({ queryKey: ["points"] });
    },
  });
}
