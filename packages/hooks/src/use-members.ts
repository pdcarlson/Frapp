"use client";

import { useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";
import { resolveDisplayName, type DisplayNameMap } from "./display-names";

export function useMembers() {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: ["members", chapterId],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/members");
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
    enabled: !!chapterId,
  });
}

/**
 * The chapter roster projected to display fields only — `GET /v1/members/roster`.
 *
 * Prefer this over {@link useMembers} whenever the surface only needs a name or
 * an avatar. `useMembers` returns the full profile, including every member's
 * email, bio, graduation year, city and company, which a display concern has no
 * business putting on a device (#1000, #986).
 *
 * Keyed under `["members", chapterId, …]` so the existing member mutations,
 * which invalidate `["members", chapterId]`, prefix-match it — removing a member
 * drops them from the roster with no extra wiring.
 */
export function useChapterRoster() {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: ["members", chapterId, "roster"],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/members/roster");
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
    enabled: !!chapterId,
  });
}

export interface MemberDisplayNames {
  /** `users.id` → `display_name`, for callers that resolve several ids at once. */
  byId: DisplayNameMap;
  /** Single-id resolver; `null` when unresolved so the caller picks its copy. */
  nameFor: (userId: string) => string | null;
  isPending: boolean;
  isError: boolean;
}

/**
 * Resolve `users.id` to a display name from one cached roster fetch.
 *
 * This is how the chat surface names message authors and DM rows. Both halves
 * are returned on purpose: `nameFor` is what a render path wants (one stable
 * callback, no per-row object churn), while `byId` is what
 * `directChannelDisplayName` wants, since it resolves a channel's whole
 * `member_ids` list.
 */
export function useMemberDisplayNames(): MemberDisplayNames {
  const query = useChapterRoster();

  // No `unknown`-parsing here, unlike the channel selectors: this route ships a
  // response DTO, so the SDK gives the rows a real type.
  const byId = useMemo<DisplayNameMap>(
    () =>
      Object.fromEntries(
        (query.data ?? []).map((row) => [row.user_id, row.display_name]),
      ),
    [query.data],
  );

  const nameFor = useCallback(
    (userId: string) => resolveDisplayName(byId, userId),
    [byId],
  );

  return {
    byId,
    nameFor,
    isPending: query.isPending,
    isError: query.isError,
  };
}

export function useMember(id: string) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: ["members", chapterId, id],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/members/{id}", {
        params: { path: { id } },
      });
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
    enabled: !!chapterId && !!id,
  });
}

export function useMemberSearch(query: string) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: ["members", chapterId, "search", query],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/members/search", {
        params: { query: { q: query } },
      });
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
    enabled: !!chapterId && !!query,
  });
}

export function useAlumni(filters?: {
  graduation_year?: string;
  city?: string;
  company?: string;
}) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: ["alumni", chapterId, filters],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/alumni", {
        params: { query: filters },
      });
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
    enabled: !!chapterId,
  });
}

export function useUpdateMemberRoles() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  return useMutation({
    mutationFn: async ({
      id,
      role_ids,
      custom_role_ids,
    }: {
      id: string;
      role_ids: string[];
      /** chapter_custom_roles ids; omit to leave the assignment unchanged. */
      custom_role_ids?: string[];
    }) => {
      const { data, error } = await client.PATCH("/v1/members/{id}/roles", {
        params: { path: { id } },
        body: {
          role_ids,
          ...(custom_role_ids !== undefined ? { custom_role_ids } : {}),
        },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["members", chapterId] });
    },
  });
}

export function useRemoveMember() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await client.DELETE("/v1/members/{id}", {
        params: { path: { id } },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["members", chapterId] });
      queryClient.invalidateQueries({ queryKey: ["chapters", chapterId] });
    },
  });
}

export function useUpdateOnboarding() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  return useMutation({
    mutationFn: async (body: { has_completed_onboarding: boolean }) => {
      const { data, error } = await client.PATCH("/v1/members/me/onboarding", {
        body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["members", chapterId] });
    },
  });
}
