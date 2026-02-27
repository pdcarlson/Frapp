"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useFrappClient } from "./use-frapp-client";

export function useNotifications(limit?: number) {
  const client = useFrappClient();
  return useQuery({
    queryKey: ["notifications", limit],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/notifications", {
        params: { query: { limit: String(limit ?? 50) } },
      });
      if (error) throw error;
      return data;
    },
    staleTime: 10_000,
  });
}

export function useNotificationPreferences(chapterId: string) {
  const client = useFrappClient();
  return useQuery({
    queryKey: ["notifications", "preferences", chapterId],
    queryFn: async () => {
      const { data, error } = await client.GET(
        "/v1/notifications/preferences",
        { params: { query: { chapterId } } },
      );
      if (error) throw error;
      return data;
    },
    staleTime: 300_000,
    enabled: !!chapterId,
  });
}

export function useUserSettings() {
  const client = useFrappClient();
  return useQuery({
    queryKey: ["settings"],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/settings");
      if (error) throw error;
      return data;
    },
    staleTime: 300_000,
  });
}

export function useRegisterPushToken() {
  const client = useFrappClient();
  return useMutation({
    mutationFn: async (body: { token: string; device_name?: string }) => {
      const { data, error } = await client.POST("/v1/push-tokens", { body });
      if (error) throw error;
      return data;
    },
  });
}

export function useRemovePushToken() {
  const client = useFrappClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await client.DELETE("/v1/push-tokens/{id}", {
        params: { path: { id } },
      });
      if (error) throw error;
      return data;
    },
  });
}

export function useMarkNotificationRead() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await client.PATCH(
        "/v1/notifications/{id}/read",
        { params: { path: { id } } },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}

export function useUpdateNotificationPreference() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: {
      chapter_id: string;
      category: string;
      is_enabled: boolean;
    }) => {
      const { data, error } = await client.PATCH(
        "/v1/notifications/preferences",
        { body },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["notifications", "preferences"],
      });
    },
  });
}

export function useUpdateUserSettings() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: {
      quiet_hours_start?: string;
      quiet_hours_end?: string;
      quiet_hours_tz?: string;
      theme?: "light" | "dark" | "system";
    }) => {
      const { data, error } = await client.PATCH("/v1/settings", { body });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
  });
}
