/**
 * The phone's Assign to sheet as rows (`components/tasks/who-picker-sheet.tsx`):
 * which lines its list draws for a tab or a search. The picker's rules (who
 * it lists, what a tick does, its words) are shared with web in
 * `@repo/hooks/task-who-picker`; only the list's shape is the phone's own.
 */

import { normalizeWords } from "@repo/hooks/fuzzy-match";
import {
  GROUPS_HEADING,
  WHO_PICKER_COPY,
  allRoles,
  allTierSets,
  tierKey,
  whoMatches,
  type WhoDirectory,
  type WhoPerson,
  type WhoSet,
} from "@repo/hooks/task-who-picker";
import { TASK_AUDIENCE_COPY, type TaskWho } from "@repo/validation";

/** Which tab the picker shows. */
export type WhoTab = "people" | "sets";

/** One line of the picker's list. */
export type WhoRow =
  | { kind: "everyone"; key: "everyone" }
  | {
      kind: "heading";
      key: string;
      label: string;
      /** A tier that folds; `undefined` for a heading that doesn't. */
      tierKey?: string;
      open?: boolean;
    }
  | { kind: "person"; key: string; person: WhoPerson; nested?: boolean }
  | {
      kind: "set";
      key: string;
      /** A tier picked whole reads "Everyone in Exec board" (#5473). */
      set: WhoSet;
      open: boolean;
    };

/**
 * The picker's rows for a tab, or for a search across people, roles and
 * groups. `single` is a picker for one person (an edit, a chat's task, an
 * officer handing over a task up for grabs): people only, no Everyone.
 */
export function whoRows(
  directory: WhoDirectory,
  options: {
    tab: WhoTab;
    search: string;
    single: boolean;
    /** Roles and groups whose members are shown, by `role:id` / `group:id`. */
    expanded: ReadonlySet<string>;
    openTiers: ReadonlySet<string>;
    /**
     * Offer a tier whole (#5473), as web's picker does. Off for a suggested
     * task, whose payload has no tier field yet, so a tier pick there would
     * send nobody. On when absent.
     */
    tiers?: boolean;
  },
): WhoRow[] {
  const tiers = options.tiers ?? true;
  const searching = normalizeWords(options.search).length > 0;
  const personRow = (person: WhoPerson, prefix = "", nested = false): WhoRow => ({
    kind: "person",
    key: `${prefix}person:${person.userId}`,
    person,
    nested,
  });
  if (options.single) {
    return directory.people
      .filter((person) => whoMatches(person.name, options.search))
      .map((person) => personRow(person));
  }
  const setRows = (set: WhoSet): WhoRow[] => {
    const key = `${set.kind}:${set.id}`;
    const open = options.expanded.has(key);
    const rows: WhoRow[] = [{ kind: "set", key, set, open }];
    if (open) {
      for (const userId of set.memberIds) {
        const person = directory.byId.get(userId);
        if (person) rows.push(personRow(person, `${key}:`, true));
      }
    }
    return rows;
  };
  if (searching) {
    const people = directory.people.filter((person) =>
      whoMatches(person.name, options.search),
    );
    const sets = [
      ...(tiers ? allTierSets(directory).map(wholeTier) : []),
      ...allRoles(directory),
      ...directory.groups,
    ].filter((set) => whoMatches(set.name, options.search));
    return [
      ...(people.length > 0
        ? [
            { kind: "heading", key: "h:people", label: WHO_PICKER_COPY.people } as const,
            ...people.map((person) => personRow(person)),
          ]
        : []),
      ...(sets.length > 0
        ? [
            {
              kind: "heading",
              key: "h:sets",
              label: WHO_PICKER_COPY.rolesAndGroups,
            } as const,
            ...sets.flatMap(setRows),
          ]
        : []),
    ];
  }
  const everyone: WhoRow = { kind: "everyone", key: "everyone" };
  if (options.tab === "people") {
    return [everyone, ...directory.people.map((person) => personRow(person))];
  }
  const rows: WhoRow[] = [everyone];
  for (const tier of directory.tiers) {
    const key = tierKey(tier);
    const open = options.openTiers.has(key);
    rows.push({
      kind: "heading",
      key: `h:tier:${key}`,
      label: tier.name,
      tierKey: key,
      open,
    });
    if (!open) continue;
    // The tier as a whole first (#5473): everyone holding a role in it, as
    // Slack's user groups sit above their members. A tier of one role is
    // that role, so it gets no second row.
    if (tiers && tier.set && tier.roles.length > 1) {
      rows.push(...setRows(wholeTier(tier.set)));
    }
    rows.push(...tier.roles.flatMap(setRows));
  }
  if (directory.groups.length > 0) {
    rows.push({ kind: "heading", key: "h:groups", label: GROUPS_HEADING });
    rows.push(...directory.groups.flatMap(setRows));
  }
  return rows;
}

/** A tier as a pick, named as the picker lists it: "Everyone in Exec board". */
function wholeTier(set: WhoSet): WhoSet {
  return { ...set, name: TASK_AUDIENCE_COPY.everyoneIn(set.name) };
}

/**
 * A value read back for a kept draft from before the picker held a
 * `TaskWho`: a member's id, or "everyone".
 */
export function whoOfLegacyAssignee(
  assigneeId: string | null | undefined,
): TaskWho | null {
  if (!assigneeId) return null;
  return assigneeId === "everyone"
    ? { kind: "each", target: { kind: "chapter" } }
    : { kind: "person", userId: assigneeId };
}
