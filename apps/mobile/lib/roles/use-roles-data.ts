import { useMemo } from "react";
import {
  useCurrentChapter,
  useMembers,
  useMyPermissions,
  useRoleTiers,
  useRoles,
  useViewerUserId,
} from "@repo/hooks";
import {
  callerReach,
  normalizeTieredRoles,
  normalizeTiers,
  tierWords,
} from "@repo/hooks/role-tiers";
import { can } from "@repo/validation";
import { memberViewVocabulary, vocab } from "@repo/org-archetypes";

/**
 * Everything the phone's Roles screens read (#4074), the same reads as web's
 * `apps/web/components/roles/use-roles-data.ts`: the roles, the chapter's
 * tiers, who holds each role, how far the caller reaches under the rank rules
 * (#4071), and the chapter's own word for a tier. The shapes and rules are
 * one copy in `@repo/hooks/role-tiers`, so the two apps never disagree on
 * what an officer may change.
 */
export function useRolesData() {
  const rolesQuery = useRoles();
  const tiersQuery = useRoleTiers();
  const membersQuery = useMembers();
  const permissionsQuery = useMyPermissions();
  const viewerUserId = useViewerUserId();
  const vocabulary = memberViewVocabulary(useCurrentChapter().data);

  const roles = useMemo(
    () => normalizeTieredRoles(rolesQuery.data),
    [rolesQuery.data],
  );
  const tiers = useMemo(
    () => normalizeTiers(tiersQuery.data),
    [tiersQuery.data],
  );

  // `null` until the members read lands, so a row shows no count rather than
  // "0" for a role that may well have members.
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

export type RolesData = ReturnType<typeof useRolesData>;

/**
 * Why nothing on a tier's or a role's screen can change, said once at the
 * top, or null when the caller may edit it. Web's pages use the same words.
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

/** The row-level refusal web shows, word for word. */
export const CANT_GIVE =
  "You can't give this, because your role doesn't have it.";
