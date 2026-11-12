"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { components } from "@repo/api-sdk";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";

/** One of the chapter's groups (#4076), as `GET /v1/groups` serves it. */
export type ChapterGroup = components["schemas"]["ChapterGroupDto"];
export type CreateChapterGroupBody =
  components["schemas"]["CreateChapterGroupDto"];
export type UpdateChapterGroupBody =
  components["schemas"]["UpdateChapterGroupDto"];

/**
 * Keyed under `["roles", chapterId, …]` on purpose: a group is pinged and
 * named in channel lists beside roles and tiers, so a group write
 * invalidates `["roles", chapterId]`, which also refreshes the mention picker
 * (`useMentionRoles`) and the channel list options.
 */
function groupsKey(chapterId: string | null | undefined) {
  return ["roles", chapterId, "groups"] as const;
}

/**
 * The chapter's groups with who is in each: manual ones first, then pledge
 * classes and class years, which the server keeps and leaves out while
 * nobody is in them. Needs `members:view`, like the Directory.
 */
export function useGroups(options?: { enabled?: boolean }) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: groupsKey(chapterId),
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/groups");
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
    enabled: (options?.enabled ?? true) && !!chapterId,
  });
}

/** The groups one member is in, in the list's order. */
export function groupsOfMember(
  groups: readonly ChapterGroup[] | undefined,
  userId: string | null | undefined,
): ChapterGroup[] {
  if (!groups || !userId) return [];
  return groups.filter((group) => group.member_ids.includes(userId));
}

function useInvalidateAfterGroupWrite() {
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  // Returned, so `mutateAsync` settles after the lists are re-read and a
  // caller never draws the old list for a frame after a success.
  return () =>
    queryClient.invalidateQueries({ queryKey: ["roles", chapterId] });
}

/** Make a manual group. Needs `groups:manage`. */
export function useCreateGroup() {
  const client = useFrappClient();
  const invalidate = useInvalidateAfterGroupWrite();
  return useMutation({
    mutationKey: ["groups", "create"],
    mutationFn: async (body: CreateChapterGroupBody) => {
      const { data, error } = await client.POST("/v1/groups", { body });
      if (error) throw error;
      return data;
    },
    onSuccess: invalidate,
  });
}

/**
 * Rename, recolor or switch pinging. Only a manual group may be renamed; an
 * automatic one's name follows its class or year. Needs `groups:manage`.
 */
export function useUpdateGroup() {
  const client = useFrappClient();
  const invalidate = useInvalidateAfterGroupWrite();
  return useMutation({
    mutationKey: ["groups", "update"],
    mutationFn: async ({
      id,
      body,
    }: {
      id: string;
      body: UpdateChapterGroupBody;
    }) => {
      const { data, error } = await client.PATCH("/v1/groups/{id}", {
        params: { path: { id } },
        body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: invalidate,
  });
}

/** A manual group's whole member list, replaced all or none. */
export function useSetGroupMembers() {
  const client = useFrappClient();
  const invalidate = useInvalidateAfterGroupWrite();
  return useMutation({
    mutationKey: ["groups", "set-members"],
    mutationFn: async ({
      id,
      memberIds,
    }: {
      id: string;
      memberIds: string[];
    }) => {
      const { data, error } = await client.PUT("/v1/groups/{id}/members", {
        params: { path: { id } },
        body: { member_ids: memberIds },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: invalidate,
  });
}

/**
 * Delete a manual group. A channel list naming it loses the entry, so the
 * channel reads are refreshed too.
 */
export function useDeleteGroup() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  return useMutation({
    mutationKey: ["groups", "delete"],
    mutationFn: async (id: string) => {
      const { error } = await client.DELETE("/v1/groups/{id}", {
        params: { path: { id } },
      });
      if (error) throw error;
    },
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ["roles", chapterId] }),
        queryClient.invalidateQueries({ queryKey: ["channels"] }),
      ]),
  });
}
