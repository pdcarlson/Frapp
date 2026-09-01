"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";
import type { components } from "@repo/api-sdk";

export function useEvents(options?: { enabled?: boolean }) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: ["events", chapterId],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/events");
      if (error) throw error;
      return data;
    },
    staleTime: 30_000,
    enabled: (options?.enabled ?? true) && !!chapterId,
  });
}

export function useEvent(id: string) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: ["events", chapterId, id],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/events/{id}", {
        params: { path: { id } },
      });
      if (error) throw error;
      return data;
    },
    staleTime: 30_000,
    enabled: !!id,
  });
}

// A mutation, not a query: this is a one-shot download triggered by a click,
// not cacheable data a screen renders. The endpoint's response isn't JSON
// (`text/calendar`), so `parseAs: "blob"` is required — without it,
// openapi-fetch's default `response.json()` throws on the ics body.
export function useDownloadEventIcs() {
  const client = useFrappClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await client.GET("/v1/events/{id}/ics", {
        params: { path: { id } },
        parseAs: "blob",
      });
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateEvent() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  return useMutation({
    mutationFn: async (body: {
      name: string;
      description?: string;
      location?: string;
      start_time: string;
      end_time: string;
      point_value: number;
      is_mandatory: boolean;
      recurrence_rule?: string;
      required_role_ids?: string[];
      notes?: string;
      // Mirrors CreateEventDto: at least 3 vertices, and the field is omitted
      // rather than sent empty when the event has no geofence (@ArrayMinSize(3)
      // makes [] a 400 here, unlike on update).
      check_in_zone?: components["schemas"]["GeofenceCoordinateDto"][];
      check_in_zone_name?: string;
    }) => {
      const { data, error } = await client.POST("/v1/events", { body });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["events", chapterId] });
    },
  });
}

export function useUpdateEvent() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  return useMutation({
    mutationFn: async ({
      id,
      body,
    }: {
      id: string;
      body: {
        name?: string;
        description?: string;
        location?: string;
        start_time?: string;
        end_time?: string;
        point_value?: number;
        is_mandatory?: boolean;
        recurrence_rule?: string;
        required_role_ids?: string[];
        notes?: string;
        // Mirrors UpdateEventDto, which deliberately drops @ArrayMinSize so an
        // empty array clears a stored zone.
        check_in_zone?: components["schemas"]["GeofenceCoordinateDto"][];
        check_in_zone_name?: string;
      };
    }) => {
      const { data, error } = await client.PATCH("/v1/events/{id}", {
        params: { path: { id } },
        body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["events", chapterId] });
    },
  });
}

export function useDeleteEvent() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await client.DELETE("/v1/events/{id}", {
        params: { path: { id } },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["events", chapterId] });
    },
  });
}
