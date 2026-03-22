"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useFrappClient } from "./use-frapp-client";

export function useEvents() {
  const client = useFrappClient();
  return useQuery({
    queryKey: ["events"],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/events");
      if (error) throw error;
      return data;
    },
    staleTime: 30_000,
  });
}

export function useEvent(id: string) {
  const client = useFrappClient();
  return useQuery({
    queryKey: ["events", id],
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

export function useEventIcs(id: string) {
  const client = useFrappClient();
  return useQuery({
    queryKey: ["events", id, "ics"],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/events/{id}/ics", {
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
    }) => {
      const { data, error } = await client.POST("/v1/events", { body });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["events"] });
    },
  });
}

export function useUpdateEvent() {
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
        description?: string;
        location?: string;
        start_time?: string;
        end_time?: string;
        point_value?: number;
        is_mandatory?: boolean;
        recurrence_rule?: string;
        required_role_ids?: string[];
        notes?: string;
        scope?: "this_instance" | "this_and_future" | "entire_series";
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
      queryClient.invalidateQueries({ queryKey: ["events"] });
    },
  });
}

export function useDeleteEvent() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      scope,
    }: {
      id: string;
      scope?: "this_instance" | "this_and_future" | "entire_series";
    }) => {
      const { data, error } = await client.DELETE("/v1/events/{id}", {
        params: {
          path: { id },
          query: scope ? { scope } : {},
        },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["events"] });
    },
  });
}
