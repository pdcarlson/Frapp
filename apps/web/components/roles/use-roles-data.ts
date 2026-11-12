"use client";

import { useMemo } from "react";
import {
  useMembers,
  useMyPermissions,
  useRoleTiers,
  useRoles,
  useViewerUserId,
} from "@repo/hooks";
import { can } from "@repo/validation";
import { vocab } from "@repo/org-archetypes";
import { useChapterVocabulary } from "@/lib/hooks/use-chapter-vocabulary";
import {
  callerReach,
  normalizeTieredRoles,
  normalizeTiers,
  tierWords,
} from "@repo/hooks/role-tiers";

/**
 * Everything the Roles pages read, in one place: the roles, the chapter's
 * tiers, who holds each role, how far the caller reaches under the rank
 * rules (#4071), and the chapter's own word for a tier.
 */
export function useRolesData() {
  const rolesQuery = useRoles();
  const tiersQuery = useRoleTiers();
  const membersQuery = useMembers();
  const permissionsQuery = useMyPermissions();
  const viewerUserId = useViewerUserId();
  const vocabulary = useChapterVocabulary();

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
