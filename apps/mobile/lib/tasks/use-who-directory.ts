import { useMemo } from "react";
import {
  useChapterRoster,
  useGroups,
  useMembers,
  useRoleTiers,
  useRoles,
  useViewerUserId,
} from "@repo/hooks";
import {
  followerChoices,
  type FollowerChoice,
} from "@repo/hooks/task-follower-choices";
import {
  buildWhoDirectory,
  type WhoDirectory,
} from "@repo/hooks/task-who-picker";

/** Where a part of the directory stands, for the picker's empty lines. */
export type WhoReadState = "loading" | "ready" | "error";

export interface WhoDirectoryRead {
  directory: WhoDirectory;
  /** The people tab: the members read, or the roster standing in for it. */
  people: WhoReadState;
  /** The roles and groups tab. */
  sets: WhoReadState;
  /**
   * The tiers, roles and groups the viewer is in, which a task they make
   * or edit can be from (#5473, `followerChoices`); empty without `groups`.
   */
  followers: FollowerChoice[];
}

/**
 * The chapter as the Assign to picker draws it (`@repo/hooks/task-who-picker`): active
 * members with their roles (`GET /v1/members`, which says who is alumni and
 * who holds what; the display-only roster can't), the roles in their tiers,
 * and the chapter's groups. A task officer holds `members:view`, which these
 * reads need. The roster stands in for the people while the members read is
 * out, so one person can still be picked.
 *
 * `groups` is off for a picker of one person, which never shows roles or
 * groups.
 */
export function useWhoDirectory(
  options: { groups?: boolean } = {},
): WhoDirectoryRead {
  const withSets = options.groups ?? true;
  const viewerUserId = useViewerUserId();
  const membersQuery = useMembers();
  const rosterQuery = useChapterRoster();
  const rolesQuery = useRoles({ enabled: withSets });
  const tiersQuery = useRoleTiers();
  const groupsQuery = useGroups({ enabled: withSets });

  const directory = useMemo(
    () =>
      buildWhoDirectory({
        members: membersQuery.data ?? null,
        roster: rosterQuery.data ?? null,
        roles: withSets ? rolesQuery.data : undefined,
        tiers: withSets ? tiersQuery.data : undefined,
        groups: withSets ? (groupsQuery.data ?? null) : null,
        viewerUserId,
      }),
    [
      membersQuery.data,
      rosterQuery.data,
      rolesQuery.data,
      tiersQuery.data,
      groupsQuery.data,
      viewerUserId,
      withSets,
    ],
  );

  const followers = useMemo(
    () =>
      withSets
        ? followerChoices(directory, {
            roles: rolesQuery.data,
            groups: groupsQuery.data ?? null,
          })
        : [],
    [withSets, directory, rolesQuery.data, groupsQuery.data],
  );

  const people: WhoReadState =
    membersQuery.data || rosterQuery.data
      ? "ready"
      : membersQuery.isError && rosterQuery.isError
        ? "error"
        : "loading";
  const sets: WhoReadState =
    rolesQuery.data && membersQuery.data
      ? "ready"
      : rolesQuery.isError || membersQuery.isError
        ? "error"
        : "loading";

  return { directory, people, sets, followers };
}
