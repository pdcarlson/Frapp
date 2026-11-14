"use client";

import { useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";
import { useListChapters } from "./use-chapters";
import { useRoles } from "./use-roles";
import { alumniRoleIdOf } from "@repo/validation";
import { parseChapterRoles, type ChapterRole } from "./chapter-roles";

/*
 * Roles members add and remove themselves (#4958): the "Non-chapter business"
 * roles an officer marks on the Roles page (intramurals, a study group, video
 * games), as Discord's onboarding questions and reaction-role bots hand out
 * interest roles. Web and the phone draw their own picker over these.
 */

/** A pickable role, and whether the viewer holds it. */
export type PickableRole = ChapterRole & { held: boolean };

/**
 * The chapter's self-assignable roles, by name, each with whether the viewer
 * holds it; none for an alum. The viewer's roles come from their membership summary
 * (`GET /v1/chapters`), which every member can read; the roles list needs
 * `members:view`, which every member who can open the picker holds.
 */
export function selectPickableRoles(
  rolesData: unknown,
  heldRoleIds: readonly string[] | undefined,
): PickableRole[] {
  const held = new Set((heldRoleIds ?? []).map((id) => id.toLowerCase()));
  // Alumni don't pick roles: the API refuses them, since a picked role an
  // event lists would let them check in past the alumni rule.
  const alumniRoleId = alumniRoleIdOf(rolesData);
  if (alumniRoleId && held.has(alumniRoleId.toLowerCase())) return [];
  return parseChapterRoles(rolesData)
    .filter((role) => role.selfAssignable)
    .map((role) => ({ ...role, held: held.has(role.id.toLowerCase()) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function usePickableRoles() {
  const chapterId = useActiveChapterId();
  const rolesQuery = useRoles();
  const chaptersQuery = useListChapters();
  const heldRoleIds = chaptersQuery.data?.find(
    (membership) => membership.chapter_id === chapterId,
  )?.role_ids;
  const roles = useMemo(
    () => selectPickableRoles(rolesQuery.data, heldRoleIds),
    [rolesQuery.data, heldRoleIds],
  );
  return {
    roles,
    isLoading: rolesQuery.isLoading || chaptersQuery.isLoading,
    isError: rolesQuery.isError || chaptersQuery.isError,
    refetch: () => {
      void rolesQuery.refetch();
      void chaptersQuery.refetch();
    },
  };
}

/**
 * Join (`join: true`) or leave a self-assignable role: `POST
 * /v1/roles/{id}/join` or `/leave`. On success the viewer's roles, their
 * permissions, the roster and the channel list are read again, so the
 * role's channels appear or go at once.
 */
export function useSetPickedRole() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  return useMutation({
    mutationKey: ["roles", "pick-role"],
    mutationFn: async ({ id, join }: { id: string; join: boolean }) => {
      const params = { params: { path: { id } } };
      const { data, error } = join
        ? await client.POST("/v1/roles/{id}/join", params)
        : await client.POST("/v1/roles/{id}/leave", params);
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["chapters"] });
      void queryClient.invalidateQueries({ queryKey: ["user", "me"] });
      void queryClient.invalidateQueries({ queryKey: ["members", chapterId] });
      void queryClient.invalidateQueries({ queryKey: ["channels"] });
    },
  });
}
