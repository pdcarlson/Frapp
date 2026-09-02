"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";

export function useRoles() {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: ["roles", chapterId],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/roles");
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
    enabled: !!chapterId,
  });
}

export function usePermissionsCatalog() {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: ["roles", chapterId, "permissions-catalog"],
    queryFn: async () => {
      const { data, error } = await client.GET(
        "/v1/roles/permissions-catalog",
      );
      if (error) throw error;
      return data;
    },
    staleTime: 300_000,
    enabled: !!chapterId,
  });
}

export function useCreateRole() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  return useMutation({
    mutationFn: async (body: {
      name: string;
      permissions: string[];
      display_order?: number;
      color?: string;
    }) => {
      const { data, error } = await client.POST("/v1/roles", { body });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["roles", chapterId] });
    },
  });
}

export function useUpdateRole() {
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
        permissions?: string[];
        display_order?: number;
        color?: string;
      };
    }) => {
      const { data, error } = await client.PATCH("/v1/roles/{id}", {
        params: { path: { id } },
        body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["roles", chapterId] });
    },
  });
}

export function useDeleteRole() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await client.DELETE("/v1/roles/{id}", {
        params: { path: { id } },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["roles", chapterId] });
      // Deleting a role can clear `chapters.default_invite_role_id` server-side
      // via `on delete set null` (#422). The config query has a 5-minute
      // staleTime, so without this the Settings card keeps showing the deleted
      // id and warns that the default "no longer exists" — about a setting the
      // server has already nulled.
      queryClient.invalidateQueries({ queryKey: ["chapter-config", chapterId] });
    },
  });
}

export function useTransferPresidency() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  return useMutation({
    mutationFn: async (body: { target_member_id: string }) => {
      const { data, error } = await client.POST(
        "/v1/roles/transfer-presidency",
        { body },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["roles", chapterId] });
      queryClient.invalidateQueries({ queryKey: ["members", chapterId] });
    },
  });
}

/**
 * Whether the caller may claim the chapter's vacant presidency right now
 * (spec/behavior/rbac.md § Presidency Transfer "Edge case"). Callers should
 * pass `enabled: false` until the current chapter's `needs_president` flag
 * (from `useCurrentChapter`) is true — every member holds `members:view`, so
 * this would otherwise poll on every Roles page visit for the common case
 * where no chapter needs a new President.
 */
export function usePresidencyClaimStatus(options?: { enabled?: boolean }) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: ["roles", chapterId, "presidency-claim-status"],
    queryFn: async () => {
      const { data, error } = await client.GET(
        "/v1/roles/presidency-claim-status",
      );
      if (error) throw error;
      return data;
    },
    staleTime: 15_000,
    enabled: !!chapterId && (options?.enabled ?? true),
  });
}

export function useClaimPresidency() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await client.POST(
        "/v1/roles/claim-presidency",
        {},
      );
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["roles", chapterId] });
      queryClient.invalidateQueries({ queryKey: ["members", chapterId] });
      queryClient.invalidateQueries({
        queryKey: ["chapters", "current", chapterId],
      });
    },
  });
}
