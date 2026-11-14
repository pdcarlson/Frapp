"use client";

import { useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";
import { useListChapters, type ChapterMembershipSummary } from "./use-chapters";
import { useRoles } from "./use-roles";
import { alumniRoleIdOf } from "@repo/validation";
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
 * The roles the viewer can join or leave themselves, by name. Joinable: every
 * marked role, unless the viewer is an alum (the API refuses an alum's join,
 * since a picked role an event lists would let them check in past the
 * alumni rule). Leave-only: a role they hold that they can't join but the API
 * still lets them leave, which is any role with no `system_key` outside the
 * tiers, so a role an officer unmarked, or one held when they became an alum,
 * never traps them (`spec/behavior/rbac.md` § Self-assignable roles). The
 * viewer's roles come from their membership summary (`GET /v1/chapters`),
 * which every member can read; the roles list needs `members:view`, which
 * every member who can open the picker holds.
 */
export function selectPickableRoles(
  rolesData: unknown,
  heldRoleIds: readonly string[] | undefined,
): PickableRole[] {
  const held = new Set((heldRoleIds ?? []).map((id) => id.toLowerCase()));
  const alumniRoleId = alumniRoleIdOf(rolesData);
  const isAlum = !!alumniRoleId && held.has(alumniRoleId.toLowerCase());
  const tiered = tieredRoleIds(rolesData);
  return parseChapterRoles(rolesData)
    .flatMap((role): PickableRole[] => {
      const holds = held.has(role.id.toLowerCase());
      const joinable = role.selfAssignable && !isAlum;
      const leavable =
        holds && !role.system_key && !role.everyone && !tiered.has(role.id);
      return joinable || leavable ? [{ ...role, held: holds, joinable }] : [];
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The ids of roles placed in a tier; `ChapterRole` doesn't carry the tier. */
function tieredRoleIds(rolesData: unknown): Set<string> {
  if (!Array.isArray(rolesData)) return new Set();
  return new Set(
    rolesData.flatMap((row: unknown) => {
      const role = row as { id?: unknown; tier_id?: unknown } | null;
      return role && typeof role.id === "string" && role.tier_id
        ? [role.id]
        : [];
    }),
  );
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
