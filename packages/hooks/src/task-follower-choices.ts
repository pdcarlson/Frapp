/**
 * The tiers, roles and groups a task can be from (#5473, `spec/behavior/tasks.md`
 * § Following a task): the ones the viewer is in, since the API takes only a
 * follower its sender is in, so "From Exec board" is true. Pure, from the
 * Who picker's directory (`./task-who-picker`) and the chapter's reads, so
 * the phone's From sheet and web's From select list the same choices.
 *
 * Left out, as the API refuses or nothing would come of them: a class year
 * (an automatic group that opens nothing), and the tier holding the Everyone
 * role, which is the whole chapter.
 */

import {
  isEveryoneRole,
  taskFollowerEntry,
  type TaskFollowerKind,
} from "@repo/validation";
import { normalizeTieredRoles } from "./role-tiers";
import {
  allRoles,
  type WhoDirectory,
  type WhoGroupSource,
} from "./task-who-picker";

/** One tier, role or group a task can be from. */
export interface FollowerChoice {
  /** The stored entry, `tier:<id>` / `role:<id>` / `group:<id>`. */
  entry: string;
  kind: TaskFollowerKind;
  name: string;
  /** How many active members it reaches now. */
  count: number;
}

/** Each kind's heading, in the order the choices list them. */
export const FOLLOWER_HEADINGS: Readonly<Record<TaskFollowerKind, string>> = {
  tier: "Tiers",
  role: "Roles",
  group: "Groups",
};

/** The viewer's choices: their tiers, then roles, then groups. */
export function followerChoices(
  directory: WhoDirectory,
  reads: {
    /** `GET /v1/roles`: which tier holds the Everyone role. */
    roles?: unknown;
    /** `GET /v1/groups`: which groups are class years. */
    groups?: readonly WhoGroupSource[] | null;
  },
): FollowerChoice[] {
  const viewer = directory.people.find((person) => person.isViewer)?.userId;
  if (!viewer) return [];
  const classYears = new Set(
    (reads.groups ?? [])
      .filter((group) => group.kind === "class_year")
      .map((group) => group.id),
  );
  const everyoneTiers = new Set(
    normalizeTieredRoles(reads.roles)
      .filter((role) => isEveryoneRole(role) && role.tier_id)
      .map((role) => role.tier_id as string),
  );
  const choices: FollowerChoice[] = [];
  const add = (
    kind: TaskFollowerKind,
    id: string,
    name: string,
    memberIds: readonly string[],
  ) => {
    if (!memberIds.includes(viewer)) return;
    choices.push({
      entry: taskFollowerEntry(kind, id),
      kind,
      name,
      count: memberIds.length,
    });
  };
  for (const tier of directory.tiers) {
    if (tier.set && !everyoneTiers.has(tier.set.id)) {
      add("tier", tier.set.id, tier.set.name, tier.set.memberIds);
    }
  }
  for (const role of allRoles(directory)) {
    add("role", role.id, role.name, role.memberIds);
  }
  for (const group of directory.groups) {
    if (!classYears.has(group.id)) {
      add("group", group.id, group.name, group.memberIds);
    }
  }
  return choices;
}
