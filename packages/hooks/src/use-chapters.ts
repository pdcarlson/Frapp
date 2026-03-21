"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useFrappClient } from "./use-frapp-client";

export function useCurrentChapter(options?: { enabled?: boolean }) {
  const client = useFrappClient();
  return useQuery({
    queryKey: ["chapters", "current"],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/chapters/current");
      if (error) throw error;
      return data;
    },
    staleTime: 300_000,
    enabled: options?.enabled ?? true,
  });
}

export function useCreateChapter() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: { name: string; university: string }) => {
      const { data, error } = await client.POST("/v1/chapters", { body });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chapters"] });
      queryClient.invalidateQueries({ queryKey: ["chapters", "current"] });
    },
  });
}

export function useUpdateChapter() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: {
      name?: string;
      university?: string;
      accent_color?: string;
      donation_url?: string;
    }) => {
      const { data, error } = await client.PATCH("/v1/chapters/current", {
        body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chapters"] });
      queryClient.invalidateQueries({ queryKey: ["chapters", "current"] });
    },
  });
}

export function useRequestLogoUploadUrl() {
  const client = useFrappClient();
  return useMutation({
    mutationFn: async (body: { filename: string; content_type: string }) => {
      const { data, error } = await client.POST(
        "/v1/chapters/current/logo-url",
        { body },
      );
      if (error) throw error;
      return data;
    },
  });
}

export function useConfirmLogo() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: { storage_path: string }) => {
      const { data, error } = await client.POST("/v1/chapters/current/logo", {
        body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chapters"] });
      queryClient.invalidateQueries({ queryKey: ["chapters", "current"] });
    },
  });
}

export function useDeleteLogo() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await client.DELETE("/v1/chapters/current/logo");
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chapters"] });
      queryClient.invalidateQueries({ queryKey: ["chapters", "current"] });
    },
  });
}
