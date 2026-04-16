"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";

export interface ChapterMembershipSummary {
  chapter_id: string;
  member_id: string;
  role_ids: string[];
  has_completed_onboarding: boolean;
  chapter: {
    id: string;
    name: string;
    university: string;
    stripe_customer_id: string | null;
    subscription_status: "incomplete" | "active" | "past_due" | "canceled";
    subscription_id: string | null;
    accent_color: string | null;
    logo_path: string | null;
    donation_url: string | null;
    created_at: string;
    updated_at: string;
  };
}

function chapterQueryKey(...parts: Array<string | null | undefined>) {
  return ["chapters", ...parts];
}

export function useListChapters() {
  const client = useFrappClient();
  return useQuery({
    queryKey: chapterQueryKey("accessible"),
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/chapters");
      if (error) throw error;
      return (data ?? []) as ChapterMembershipSummary[];
    },
    staleTime: 60_000,
  });
}

export const useAccessibleChapters = useListChapters;

export function useCurrentChapter(options?: {
  chapterId?: string | null;
  enabled?: boolean;
}) {
  const client = useFrappClient();
  const activeChapterId = useActiveChapterId();
  const chapterId = options?.chapterId ?? activeChapterId ?? null;
  const baseEnabled = options?.enabled ?? true;
  const enabled = baseEnabled && !!chapterId;

  return useQuery({
    queryKey: chapterQueryKey("current", chapterId),
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/chapters/current");
      if (error) throw error;
      return data;
    },
    staleTime: 300_000,
    enabled,
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
      queryClient.invalidateQueries({ queryKey: chapterQueryKey() });
    },
  });
}

export function useUpdateChapter() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const activeChapterId = useActiveChapterId();
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
      queryClient.invalidateQueries({ queryKey: chapterQueryKey() });
      queryClient.invalidateQueries({
        queryKey: chapterQueryKey("current", activeChapterId ?? null),
      });
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
  const activeChapterId = useActiveChapterId();
  return useMutation({
    mutationFn: async (body: { storage_path: string }) => {
      const { data, error } = await client.POST("/v1/chapters/current/logo", {
        body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: chapterQueryKey() });
      queryClient.invalidateQueries({
        queryKey: chapterQueryKey("current", activeChapterId ?? null),
      });
    },
  });
}

export function useDeleteLogo() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const activeChapterId = useActiveChapterId();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await client.DELETE("/v1/chapters/current/logo");
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: chapterQueryKey() });
      queryClient.invalidateQueries({
        queryKey: chapterQueryKey("current", activeChapterId ?? null),
      });
    },
  });
}
