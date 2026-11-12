import {
  useCurrentChapter,
  useMembers,
  useMyPermissions,
  useRoleTiers,
  useRoles,
  useViewerUserId,
} from "@repo/hooks";
import { useRolesDataFrom } from "@repo/hooks/use-roles-data";
import { memberViewVocabulary } from "@repo/org-archetypes";

export {
  CANT_GIVE,
  lockedReasonFor,
  type RolesData,
} from "@repo/hooks/use-roles-data";

/**
 * The phone's Roles screens' reads (#4074), the same as web's through
 * `@repo/hooks/use-roles-data`, so the two apps never disagree on what an
 * officer may change.
 */
export function useRolesData() {
  return useRolesDataFrom({
    rolesQuery: useRoles(),
    tiersQuery: useRoleTiers(),
    membersQuery: useMembers(),
    permissionsQuery: useMyPermissions(),
    viewerUserId: useViewerUserId(),
    vocabulary: memberViewVocabulary(useCurrentChapter().data),
  });
}
