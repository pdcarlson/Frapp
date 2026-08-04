"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useFrappClient, useActiveChapterId } from "@repo/hooks";
import type {
  ChapterCustomRole,
  CreateCustomRole,
  UpdateCustomRole,
} from "@repo/validation";

/**
 * Request bodies derived from the shared zod schemas so the hook stays in sync
 * with the API's validation contract (`@repo/validation`).
 */
export type CreateCustomRoleInput = CreateCustomRole;
export type UpdateCustomRoleInput = UpdateCustomRole;

/**
 * Lists the chapter's `chapter_custom_roles` (Settings → Roles → Custom),
 * ordered by rank. Mirrors the chapter-config hooks: scoped to the active
 * chapter, query key `["custom-roles", chapterId]`.
 *
 * The endpoint requires `chapter-config:view`, so callers rendered for
 * ordinary members (e.g. the member directory) should pass `enabled: false`
 * until the viewer's permission is confirmed — otherwise every mount fires a
 * guaranteed-403 request that the query client retries and refires on focus.
 */
export function useCustomRoles(options?: { enabled?: boolean }) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();

  return useQuery({
    queryKey: ["custom-roles", chapterId],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/custom-roles");
      if (error) throw error;
      // The SDK response (CustomRoleDto[]) is structurally the shared
      // ChapterCustomRole; surface the shared type to consumers.
      return (data ?? []) as ChapterCustomRole[];
    },
    enabled: !!chapterId && (options?.enabled ?? true),
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
