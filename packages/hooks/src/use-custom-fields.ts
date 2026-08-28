"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useFrappClient, useActiveChapterId } from "./use-frapp-client";
import type {
  ChapterCustomField,
  CreateCustomField,
  UpdateCustomField,
} from "@repo/validation";

/**
 * Request bodies derived from the shared zod schemas so the hook stays in sync
 * with the API's validation contract (`@repo/validation`).
 */
export type CreateCustomFieldInput = CreateCustomField;
export type UpdateCustomFieldInput = UpdateCustomField;

/**
 * Lists the chapter's `chapter_custom_fields` (Settings → Fields), ordered by
 * sort. Mirrors the custom-roles hook: scoped to the active chapter, query key
 * `["custom-fields", chapterId]`.
 */
export function useCustomFields() {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();

  return useQuery({
    queryKey: ["custom-fields", chapterId],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/custom-fields");
      if (error) throw error;
      // The SDK response (CustomFieldDto[]) is structurally the shared
      // ChapterCustomField; surface the shared type to consumers.
      return (data ?? []) as ChapterCustomField[];
    },
    enabled: !!chapterId,
    staleTime: 60_000,
  });
}

export function useCreateCustomField() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();

  return useMutation({
    mutationFn: async (body: CreateCustomFieldInput) => {
      const { data, error } = await client.POST("/v1/custom-fields", {
        body: body as never,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["custom-fields", chapterId],
      });
    },
  });
}

export function useUpdateCustomField() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();

  return useMutation({
    mutationFn: async ({
      id,
      body,
    }: {
      id: string;
      body: UpdateCustomFieldInput;
    }) => {
      const { data, error } = await client.PATCH("/v1/custom-fields/{id}", {
        params: { path: { id } },
        body: body as never,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["custom-fields", chapterId],
      });
    },
  });
}

export function useDeleteCustomField() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();

  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await client.DELETE("/v1/custom-fields/{id}", {
        params: { path: { id } },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["custom-fields", chapterId],
      });
    },
  });
}
