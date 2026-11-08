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
      // Attendance by role (`@repo/validation` § event-attendance). Send
      // `others_invited` whenever a role list is sent.
      required_role_ids?: string[];
      optional_role_ids?: string[];
      excluded_role_ids?: string[];
      others_invited?: boolean;
      notes?: string;
      // Mirrors CreateEventDto: at least 3 vertices, and the field is omitted
      // rather than sent empty when the event has no geofence (@ArrayMinSize(3)
      // makes [] a 400 here, unlike on update).
      check_in_zone?: components["schemas"]["GeofenceCoordinateDto"][];
      check_in_zone_name?: string;
      // Minutes before the start that check-in opens; the server defaults it.
      check_in_opens_minutes?: number;
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
        // `null` ends a series (`UpdateEventDto` lets `@IsOptional` pass it).
        recurrence_rule?: string | null;
        required_role_ids?: string[];
        optional_role_ids?: string[];
        excluded_role_ids?: string[];
        others_invited?: boolean;
        notes?: string;
        // Mirrors UpdateEventDto, which deliberately drops @ArrayMinSize so an
        // empty array clears a stored zone.
        check_in_zone?: components["schemas"]["GeofenceCoordinateDto"][];
        check_in_zone_name?: string;
        check_in_opens_minutes?: number;
        // Which rows of a repeating series the edit reaches
        // (`spec/behavior/events.md` § Recurrence edit and cancellation scope).
        scope?: "instance" | "series";
      };
    }) => {
      const { data, error } = await client.PATCH("/v1/events/{id}", {
        params: { path: { id } },
        // The generated type has no `null` for the rule; the DTO accepts it.
        body: body as components["schemas"]["UpdateEventDto"],
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
    // A bare id deletes one event; `scope: "series"` cancels a repeating
    // series from now forward.
    mutationFn: async (
      target: string | { id: string; scope?: "instance" | "series" },
    ) => {
      const { id, scope } =
        typeof target === "string" ? { id: target, scope: undefined } : target;
      const { data, error } = await client.DELETE("/v1/events/{id}", {
        params: { path: { id }, ...(scope ? { query: { scope } } : {}) },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["events", chapterId] });
    },
  });
}
