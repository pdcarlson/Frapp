"use client";

import { useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";
import { useListChapters, type ChapterMembershipSummary } from "./use-chapters";
import { useRoles } from "./use-roles";
import { alumniRoleIdOf, can } from "@repo/validation";
import { usePermissionList } from "./use-user";
import { parseChapterRoles, type ChapterRole } from "./chapter-roles";

/*
 * Roles members add and remove themselves (#4958): the "Non-chapter business"
 * roles an officer marks on the Roles page (intramurals, a study group, video
 * games), as Discord's onboarding questions and reaction-role bots hand out
 * interest roles. Web and the phone draw their own picker over these.
 */

/**
 * A role the picker lists: whether the viewer holds it, and whether they can
 * join it. A row that can't be joined is one they hold and may only leave.
 */
export type PickableRole = ChapterRole & { held: boolean; joinable: boolean };

/**
 * The roles the viewer can join or leave themselves, by name: the marked
 * ones, which are the only roles the API lets a member join or leave (#5650;
 * a role an officer gave, or has stopped offering, stays until an officer
 * takes it off). Joinable: every marked role, unless the viewer is an alum
 * (the API refuses an alum's join, since a picked role an event lists would
 * let them check in past the alumni rule). Leave-only: a marked role an alum
 * holds (`spec/behavior/rbac.md` § Self-assignable roles). The
 * viewer's roles come from their membership summary (`GET /v1/chapters`),
 * which every member can read; the roles list needs `members:view`, so
 * `usePickableRoles` reads it only for a viewer who holds that.
 */
export function selectPickableRoles(
  rolesData: unknown,
  heldRoleIds: readonly string[] | undefined,
): PickableRole[] {
  const held = new Set((heldRoleIds ?? []).map((id) => id.toLowerCase()));
  const alumniRoleId = alumniRoleIdOf(rolesData);
  const isAlum = !!alumniRoleId && held.has(alumniRoleId.toLowerCase());
  return parseChapterRoles(rolesData)
    .flatMap((role): PickableRole[] => {
      if (!role.selfAssignable) return [];
      const holds = held.has(role.id.toLowerCase());
      const joinable = !isAlum;
      return joinable || holds ? [{ ...role, held: holds, joinable }] : [];
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function usePickableRoles() {
  const chapterId = useActiveChapterId();
  // `GET /v1/roles` needs `members:view`: a viewer without it is offered
  // nothing rather than sending a read the API always refuses.
  const canListRoles = can("members:view", usePermissionList());
  const rolesQuery = useRoles({ enabled: canListRoles });
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
    /**
     * Whether the viewer's own roles have been read. Until they have, every
     * role reads as not held and the viewer as no alum, so a surface that
     * draws Join or Leave from `roles` waits for this (#4958 review).
     */
    heldKnown: heldRoleIds !== undefined,
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
/** {@link useSetPickedRole}'s key, so a screen can wait on a pick in flight. */
export const PICK_ROLE_MUTATION_KEY = ["roles", "pick-role"] as const;

export function useSetPickedRole() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  return useMutation({
    mutationKey: PICK_ROLE_MUTATION_KEY,
    mutationFn: async ({ id, join }: { id: string; join: boolean }) => {
      const params = { params: { path: { id } } };
      const { data, error } = join
        ? await client.POST("/v1/roles/{id}/join", params)
        : await client.POST("/v1/roles/{id}/leave", params);
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      // The answer carries the viewer's roles after the change: written into
      // the membership summary at once, so each switch shows what was saved
      // as soon as it unlocks, rather than its old state until the read
      // below comes back.
      const roleIds = (data as { role_ids?: unknown } | undefined)?.role_ids;
      if (Array.isArray(roleIds)) {
        queryClient.setQueryData<ChapterMembershipSummary[]>(
          ["chapters", "accessible"],
          (memberships) =>
            memberships?.map((membership) =>
              membership.chapter_id === chapterId
                ? { ...membership, role_ids: roleIds as string[] }
                : membership,
            ),
        );
      }
      void queryClient.invalidateQueries({ queryKey: ["chapters"] });
      void queryClient.invalidateQueries({ queryKey: ["user", "me"] });
      void queryClient.invalidateQueries({ queryKey: ["members", chapterId] });
      void queryClient.invalidateQueries({ queryKey: ["channels"] });
    },
  });
}
