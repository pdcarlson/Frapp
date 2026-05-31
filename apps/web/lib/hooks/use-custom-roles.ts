"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useFrappClient, useActiveChapterId } from "@repo/hooks";
import type { ChapterCustomRole } from "@repo/validation";

/** Body for creating a custom role (`POST /v1/custom-roles`). */
export interface CreateCustomRoleInput {
  key: string;
  label: string;
  rank?: number;
  capabilities?: string[];
  core?: boolean;
}

/** Body for editing a custom role (`PATCH /v1/custom-roles/:id`). */
export interface UpdateCustomRoleInput {
  label?: string;
  rank?: number;
  capabilities?: string[];
}

/**
 * Lists the chapter's `chapter_custom_roles` (Settings → Roles → Custom),
 * ordered by rank. Mirrors the chapter-config hooks: scoped to the active
 * chapter, query key `["custom-roles", chapterId]`.
 */
export function useCustomRoles() {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();

  return useQuery({
    queryKey: ["custom-roles", chapterId],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/custom-roles");
      if (error) throw error;
      return (data ?? []) as unknown as ChapterCustomRole[];
    },
    enabled: !!chapterId,
    staleTime: 60_000,
  });
}

export function useCreateCustomRole() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();

  return useMutation({
    mutationFn: async (body: CreateCustomRoleInput) => {
      const { data, error } = await client.POST("/v1/custom-roles", {
        body: body as never,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["custom-roles", chapterId],
      });
    },
  });
}

export function useUpdateCustomRole() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();

  return useMutation({
    mutationFn: async ({
      id,
      body,
    }: {
      id: string;
      body: UpdateCustomRoleInput;
    }) => {
      const { data, error } = await client.PATCH("/v1/custom-roles/{id}", {
        params: { path: { id } },
        body: body as never,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["custom-roles", chapterId],
      });
    },
  });
}

export function useDeleteCustomRole() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();

  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await client.DELETE("/v1/custom-roles/{id}", {
        params: { path: { id } },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["custom-roles", chapterId],
      });
    },
  });
}
