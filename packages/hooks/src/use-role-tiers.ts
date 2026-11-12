"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { components } from "@repo/api-sdk";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";

/** One of the chapter's tiers of roles (#4071), highest first by `position`. */
export type RoleTier = components["schemas"]["RoleTierDto"];
export type CreateRoleTierBody = components["schemas"]["CreateRoleTierDto"];
export type UpdateRoleTierBody = components["schemas"]["UpdateRoleTierDto"];

/**
 * Keyed under `["roles", chapterId, …]` on purpose: a tier's permissions are
 * written through to every role in it, so a tier write invalidates the roles,
 * and a role write (moving a role between tiers) refreshes this list too.
 */
function tiersKey(chapterId: string | null | undefined) {
  return ["roles", chapterId, "tiers"] as const;
}

/** The chapter's role tiers (`GET /v1/role-tiers`), highest first. */
export function useRoleTiers() {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: tiersKey(chapterId),
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/role-tiers");
      if (error) throw error;
      return [...(data ?? [])].sort((a, b) => a.position - b.position);
    },
    staleTime: 60_000,
    enabled: !!chapterId,
  });
}

/**
 * What a tier write changes beyond the tier list: every role in the tier is
 * rewritten (so the roles list), and the caller may hold one of those roles
 * (so their own permission set). The roster and channel member lists rank by
 * role, as in `useUpdateRole`.
 */
function useInvalidateAfterTierWrite() {
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["roles", chapterId] });
    void queryClient.invalidateQueries({
      queryKey: ["user", "me", "permissions", chapterId],
    });
    void queryClient.invalidateQueries({
      queryKey: ["members", chapterId, "channel"],
    });
  };
}

export function useCreateRoleTier() {
  const client = useFrappClient();
  const invalidate = useInvalidateAfterTierWrite();
  return useMutation({
    mutationKey: ["roles", "create-tier"],
    mutationFn: async (body: CreateRoleTierBody) => {
      const { data, error } = await client.POST("/v1/role-tiers", { body });
      if (error) throw error;
      return data;
    },
    onSuccess: invalidate,
  });
}

export function useUpdateRoleTier() {
  const client = useFrappClient();
  const invalidate = useInvalidateAfterTierWrite();
  return useMutation({
    mutationKey: ["roles", "update-tier"],
    mutationFn: async ({
      id,
      body,
    }: {
      id: string;
      body: UpdateRoleTierBody;
    }) => {
      const { data, error } = await client.PATCH("/v1/role-tiers/{id}", {
        params: { path: { id } },
        body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: invalidate,
  });
}

/** Reorder: every tier id, highest first. 409 when the list changed since read. */
export function useReorderRoleTiers() {
  const client = useFrappClient();
  const invalidate = useInvalidateAfterTierWrite();
  return useMutation({
    mutationKey: ["roles", "reorder-tiers"],
    mutationFn: async (tierIds: string[]) => {
      const { data, error } = await client.PUT("/v1/role-tiers/order", {
        body: { tier_ids: tierIds },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: invalidate,
  });
}

/** Delete an empty tier; 409 while a role still sits in it. */
export function useDeleteRoleTier() {
  const client = useFrappClient();
  const invalidate = useInvalidateAfterTierWrite();
  return useMutation({
    mutationKey: ["roles", "delete-tier"],
    mutationFn: async (id: string) => {
      const { data, error } = await client.DELETE("/v1/role-tiers/{id}", {
        params: { path: { id } },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: invalidate,
  });
}
