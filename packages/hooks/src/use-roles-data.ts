"use client";

import { useMemo } from "react";
import { can } from "@repo/validation";
import { vocab, type VocabConfig } from "@repo/org-archetypes";
import {
  callerReach,
  normalizeTieredRoles,
  normalizeTiers,
  tierWords,
} from "./role-tiers";
import type { useMembers } from "./use-members";
import type { useRoleTiers } from "./use-role-tiers";
import type { useRoles } from "./use-roles";
import type { useMyPermissions } from "./use-user";

/** The reads `useRolesData` works from, as each app's own hooks return them. */
export interface RolesReads {
  rolesQuery: ReturnType<typeof useRoles>;
  tiersQuery: ReturnType<typeof useRoleTiers>;
  membersQuery: ReturnType<typeof useMembers>;
  permissionsQuery: ReturnType<typeof useMyPermissions>;
  viewerUserId: string | null | undefined;
  vocabulary: VocabConfig | undefined;
}

/**
 * Everything the Roles pages read, on web and the phone (#4074): the roles,
 * the chapter's tiers, who holds each role, how far the caller reaches under
 * the rank rules (#4071), and the chapter's own word for a tier.
 *
 * Each app's `useRolesData` makes the reads and passes them in, so the app
 * picks the active chapter its own way and its specs can mock `@repo/hooks`.
 */
export function useRolesDataFrom({
  rolesQuery,
  tiersQuery,
  membersQuery,
  permissionsQuery,
  viewerUserId,
  vocabulary,
}: RolesReads) {
  const roles = useMemo(
    () => normalizeTieredRoles(rolesQuery.data),
    [rolesQuery.data],
  );
  const tiers = useMemo(
    () => normalizeTiers(tiersQuery.data),
    [tiersQuery.data],
  );

  // `null` until the members read lands, so a row shows no count rather than
  // "0 members" for a role that may well have some.
  const memberCounts = useMemo(() => {
    if (!membersQuery.isSuccess) return null;
    const counts = new Map<string, number>();
    for (const member of membersQuery.data ?? []) {
      for (const roleId of member.role_ids ?? []) {
        counts.set(roleId, (counts.get(roleId) ?? 0) + 1);
      }
    }
    return counts;
  }, [membersQuery.data, membersQuery.isSuccess]);

  const myRoleIds = useMemo(() => {
    if (!viewerUserId || !membersQuery.isSuccess) return null;
    const me = (membersQuery.data ?? []).find(
      (member) => member.user_id === viewerUserId,
    );
    return me ? [...(me.role_ids ?? [])] : null;
  }, [membersQuery.data, membersQuery.isSuccess, viewerUserId]);

  const myPermissions = useMemo(
    () => permissionsQuery.data?.permissions ?? [],
    [permissionsQuery.data],
  );
  const reach = useMemo(
    () => callerReach(myRoleIds, myPermissions, roles, tiers),
    [myRoleIds, myPermissions, roles, tiers],
  );

  return {
    rolesQuery,
    tiersQuery,
    roles,
    tiers,
    memberCounts,
    reach,
    canManage: can("roles:manage", myPermissions),
    words: tierWords(vocab("tier", vocabulary)),
  };
}

export type RolesData = ReturnType<typeof useRolesDataFrom>;

/**
 * Why nothing on a tier's or a role's page can change, said once at the top,
 * or null when the caller may edit it. `what` names the thing ("role", or the
 * chapter's word for a tier).
 */
export function lockedReasonFor(
  data: Pick<RolesData, "canManage" | "reach">,
  editable: boolean,
  what: string,
): string | null {
  if (!data.canManage) return "Your role can't change permissions.";
  if (!data.reach.known) return "Checking what your role can change.";
  if (!editable) {
    return `This ${what} ranks at or above yours, so your role can't change it.`;
  }
  return null;
}

/** Why a permission row the caller doesn't hold can't be switched on. */
export const CANT_GIVE =
  "You can't give this, because your role doesn't have it.";
