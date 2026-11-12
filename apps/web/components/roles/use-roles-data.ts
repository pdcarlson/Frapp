"use client";

import {
  useMembers,
  useMyPermissions,
  useRoleTiers,
  useRoles,
  useViewerUserId,
} from "@repo/hooks";
import { useRolesDataFrom } from "@repo/hooks/use-roles-data";
import { useChapterVocabulary } from "@/lib/hooks/use-chapter-vocabulary";

/**
 * The Roles pages' reads (`@repo/hooks/use-roles-data`, shared with the
 * phone), for the chapter the web store has active.
 */
export function useRolesData() {
  return useRolesDataFrom({
    rolesQuery: useRoles(),
    tiersQuery: useRoleTiers(),
    membersQuery: useMembers(),
    permissionsQuery: useMyPermissions(),
    viewerUserId: useViewerUserId(),
    vocabulary: useChapterVocabulary(),
  });
}
