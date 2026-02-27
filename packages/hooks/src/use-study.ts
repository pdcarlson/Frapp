"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useFrappClient } from "./use-frapp-client";

export function useGeofences() {
  const client = useFrappClient();
  return useQuery({
    queryKey: ["geofences"],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/geofences");
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
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
