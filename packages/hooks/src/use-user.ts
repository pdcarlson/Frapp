"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useFrappClient } from "./use-frapp-client";

export function useCurrentUser() {
  const client = useFrappClient();
  return useQuery({
    queryKey: ["user", "me"],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/users/me");
      if (error) throw error;
      return data;
    },
    staleTime: 300_000,
  });
}

export function useUpdateUser() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: {
      display_name?: string;
      bio?: string;
      avatar_url?: string;
      graduation_year?: number;
      current_city?: string;
      current_company?: string;
    }) => {
      const { data, error } = await client.PATCH("/v1/users/me", { body });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user", "me"] });
    },
  });
}

export function useRequestAvatarUploadUrl() {
  const client = useFrappClient();
  return useMutation({
    mutationFn: async (body: { filename: string; content_type: string }) => {
      const { data, error } = await client.POST("/v1/users/me/avatar-url", { body });
      if (error) throw error;
      return data;
    },
  });
}
