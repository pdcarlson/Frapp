/**
 * Who a task is for, as the phone's Assign to picker reads and writes it
 * (Paul, 2026-11-18, the Tasks overhaul's § 2 "Picking who"): several people
 * with a tick each, a role or a chapter group ticked as a whole, or everyone
 * in the chapter, narrowing like a tree; and, once more than one person is
 * in, whether each of them does it or one of them claims it from Up for
 * grabs.
 *
 * Pure: the screen reads the chapter (`use-who-directory.ts`) and hands it
 * here as a {@link WhoDirectory}; the picker's value is a `TaskWho` from
 * `@repo/validation`, which also turns it into the create
 * (`taskWhoRequest`). Every word comes from `TASK_AUDIENCE_COPY`.
 *
 * ## Ticking is a set of people
 *
 * Whatever the value is (the chapter, a role, a group, a list), the ticks
 * read it as the active members it reaches. Ticking a person adds them to
 * that set, unticking one takes them out, and a set no longer equal to a
 * role or group becomes a list of people: "unticking one member narrows it to
 * those people" (the design's words). A role or group ticked whole is kept
 * as the role or group, so a committee's task follows who's in it at the
 * time of a claim.
 */

import { matchesWordStarts, normalizeWords } from "@repo/hooks/fuzzy-match";
import {
  byDisplayOrder,
  normalizeTieredRoles,
  normalizeTiers,
} from "@repo/hooks/role-tiers";
import {
  TASK_AUDIENCE_COPY,
  isEveryoneRole,
  normalizeTaskWho,
  type TaskWho,
  type TaskWhoTarget,
} from "@repo/validation";

/** One active member the picker can tick. */
export interface WhoPerson {
  userId: string;
  /** Their name, or the fallback ("Member 2f4a1c") when they set none. */
  name: string;
  /** Whether they set a name: an unnamed viewer is still "You". */
  named: boolean;
  isViewer: boolean;
}

/** A role or chapter group, with the active members it reaches now. */
export interface WhoSet {
  kind: "role" | "group";
  id: string;
  name: string;
  memberIds: string[];
}

/** A tier heading and its roles, in the chapter's own order. */
export interface WhoTier {
  /** `null` for roles outside every tier. */
  id: string | null;
  name: string;
  roles: WhoSet[];
}

/** The chapter as the picker draws it. */
export interface WhoDirectory {
  /** Active members, the viewer first, then by name. Alumni left out. */
  people: WhoPerson[];
  tiers: WhoTier[];
  groups: WhoSet[];
  /** Every active member's id, in {@link people}'s order. */
  activeIds: string[];
}

/** A member read off `GET /v1/members`, or the roster when that isn't there. */
export interface WhoMemberSource {
  user_id?: string | null;
  display_name?: string | null;
  role_ids?: readonly string[] | null;
  is_alumni?: boolean | null;
}

/** A group read off `GET /v1/groups`. */
export interface WhoGroupSource {
  id: string;
  name: string;
  kind?: string;
  member_ids: readonly string[];
}

/** The Alumni role's rename-proof key: a task can't go to it. */
const ALUMNI_ROLE_KEY = "ALUMNI";

/** The heading for roles in no tier, after the chapter's own tiers. */
export const OTHER_ROLES_HEADING = "Other roles";
/** The heading over the chapter's groups. */
export const GROUPS_HEADING = "Groups";
/** The row at the top of both tabs. */
export const EVERYONE_IN_CHAPTER = TASK_AUDIENCE_COPY.everyoneIn("the chapter");
/** A role or group nobody active holds, greyed. */
export const NOBODY_YET = "Nobody yet";

/** The words on the picker's controls, beside `TASK_AUDIENCE_COPY`'s. */
export const WHO_PICKER_COPY = {
  title: "Assign to",
  search: "Search people, roles and groups",
  searchPeople: "Search members",
  people: "People",
  rolesAndGroups: "Roles and groups",
  each: "Each does it",
  someone: "One claims it",
  you: "you",
  loading: "Loading your chapter…",
  noMatch: "Nothing matches that search.",
  setsFailed: "Couldn't load your chapter's roles and groups.",
  noSets: "Your chapter has no roles or groups to pick yet.",
} as const;

/** How many roles a chapter has before its tiers start folded. */
export const TIERS_FOLD_FROM = 12;

/**
 * The directory from the chapter's reads. `members` (`GET /v1/members`)
 * carries alumni and role holders; without it (still loading, or refused)
 * the roster stands in for the people, and roles count nobody.
 */
export function buildWhoDirectory(input: {
  members?: readonly WhoMemberSource[] | null;
  roster?: readonly WhoMemberSource[] | null;
  roles?: unknown;
  tiers?: unknown;
  groups?: readonly WhoGroupSource[] | null;
  viewerUserId: string | null;
  /** A member's name when theirs is blank ("Member 2f4a1c"). */
  fallbackName: (userId: string) => string;
}): WhoDirectory {
  const source = input.members ?? input.roster ?? [];
  const seen = new Set<string>();
  const people: WhoPerson[] = [];
  const roleIdsOf = new Map<string, readonly string[]>();
  for (const row of source) {
    const userId = row.user_id;
    if (!userId || seen.has(userId) || row.is_alumni === true) continue;
    seen.add(userId);
    const own = row.display_name?.trim() ?? "";
    people.push({
      userId,
      name: own || input.fallbackName(userId),
      named: own.length > 0,
      isViewer: userId === input.viewerUserId,
    });
    roleIdsOf.set(userId, row.role_ids ?? []);
  }
  people.sort(
    (a, b) =>
      Number(b.isViewer) - Number(a.isViewer) || a.name.localeCompare(b.name),
  );
  const activeIds = people.map((person) => person.userId);

  const holders = (roleId: string) =>
    activeIds.filter((userId) => roleIdsOf.get(userId)?.includes(roleId));

  const roles = normalizeTieredRoles(input.roles)
    .filter(
      (role) => !isEveryoneRole(role) && role.system_key !== ALUMNI_ROLE_KEY,
    )
    .sort(byDisplayOrder);
  const tierRows = normalizeTiers(input.tiers);
  const known = new Set(tierRows.map((tier) => tier.id));
  const asSet = (role: (typeof roles)[number]): WhoSet => ({
    kind: "role",
    id: role.id,
    name: role.name.trim() || "Unnamed role",
    memberIds: holders(role.id),
  });
  const tiers: WhoTier[] = tierRows
    .map((tier) => ({
      id: tier.id,
      name: tier.name,
      roles: roles.filter((role) => role.tier_id === tier.id).map(asSet),
    }))
    .filter((tier) => tier.roles.length > 0);
  const loose = roles.filter(
    (role) => !role.tier_id || !known.has(role.tier_id),
  );
  if (loose.length > 0) {
    tiers.push({ id: null, name: OTHER_ROLES_HEADING, roles: loose.map(asSet) });
  }

  const active = new Set(activeIds);
  const groups: WhoSet[] = (input.groups ?? []).flatMap((group) => {
    const memberIds = activeIds.filter(
      (userId) => active.has(userId) && group.member_ids.includes(userId),
    );
    // An automatic group nobody is in is left out of pickers (the API's
    // rule); a manual one shows, greyed, so it doesn't silently make nothing.
    if (memberIds.length === 0 && group.kind && group.kind !== "manual") {
      return [];
    }
    return [{ kind: "group" as const, id: group.id, name: group.name, memberIds }];
  });

  return { people, tiers, groups, activeIds };
}

/** Every role in the directory, tier by tier. */
export function allRoles(directory: WhoDirectory): WhoSet[] {
  return directory.tiers.flatMap((tier) => tier.roles);
}

function findSet(
  directory: WhoDirectory,
  kind: "role" | "group",
  id: string,
): WhoSet | undefined {
  return kind === "role"
    ? allRoles(directory).find((role) => role.id === id)
    : directory.groups.find((group) => group.id === id);
}

function findPerson(
  directory: WhoDirectory,
  userId: string,
): WhoPerson | undefined {
  return directory.people.find((person) => person.userId === userId);
}

/** The active members a target reaches, as the picker knows them now. */
export function targetMemberIds(
  target: TaskWhoTarget,
  directory: WhoDirectory,
): string[] {
  switch (target.kind) {
    case "chapter":
      return directory.activeIds;
    case "role":
    case "group":
      return findSet(directory, target.kind, target.id)?.memberIds ?? [];
    case "people":
      return target.userIds;
  }
}

/** The people a value ticks, in order. */
export function tickedIds(
  who: TaskWho | null,
  directory: WhoDirectory,
): string[] {
  if (!who) return [];
  if (who.kind === "person") return [who.userId];
  return targetMemberIds(who.target, directory);
}

/** How many people a value reaches. */
export function whoCount(who: TaskWho | null, directory: WhoDirectory): number {
  return tickedIds(who, directory).length;
}

/** Each does it, or one of them claims it. */
export type WhoMode = "each" | "someone";

export function whoMode(who: TaskWho | null): WhoMode {
  return who?.kind === "someone" ? "someone" : "each";
}

/** A value with its mode set; one person has none. */
export function withMode(who: TaskWho | null, mode: WhoMode): TaskWho | null {
  if (!who || who.kind === "person") return who;
  return { kind: mode, target: who.target };
}

/** Whether a value is more than one person, so the mode means something. */
export function isGroupWho(who: TaskWho | null): boolean {
  return !!who && who.kind !== "person";
}

/** A list of people as a value: nobody, one person, or several. */
function fromIds(ids: readonly string[], mode: WhoMode): TaskWho | null {
  return normalizeTaskWho({
    kind: mode,
    target: { kind: "people", userIds: [...ids] },
  });
}

/** A tick's three states: on, partly on (some of a set), off. */
export type Tick = "all" | "some" | "none";

function tickOf(members: readonly string[], ticked: ReadonlySet<string>): Tick {
  if (members.length === 0) return "none";
  const on = members.filter((id) => ticked.has(id)).length;
  return on === 0 ? "none" : on === members.length ? "all" : "some";
}

/** "Everyone in the chapter": on, partly on, or off. */
export function chapterTick(
  who: TaskWho | null,
  directory: WhoDirectory,
): Tick {
  if (who && who.kind !== "person" && who.target.kind === "chapter") {
    return "all";
  }
  return tickedIds(who, directory).length > 0 ? "some" : "none";
}

/** A role's or group's tick. */
export function setTick(
  set: WhoSet,
  who: TaskWho | null,
  directory: WhoDirectory,
): Tick {
  return tickOf(set.memberIds, new Set(tickedIds(who, directory)));
}

/** Whether one person is ticked. */
export function personTicked(
  userId: string,
  who: TaskWho | null,
  directory: WhoDirectory,
): boolean {
  return tickedIds(who, directory).includes(userId);
}

/** Tick or untick one person. */
export function togglePerson(
  who: TaskWho | null,
  userId: string,
  mode: WhoMode,
  directory: WhoDirectory,
): TaskWho | null {
  const ids = tickedIds(who, directory);
  return fromIds(
    ids.includes(userId) ? ids.filter((id) => id !== userId) : [...ids, userId],
    mode,
  );
}

/** Tick or untick everyone in the chapter. */
export function toggleChapter(
  who: TaskWho | null,
  mode: WhoMode,
  directory: WhoDirectory,
): TaskWho | null {
  return chapterTick(who, directory) === "all"
    ? null
    : { kind: mode, target: { kind: "chapter" } };
}

/**
 * Tick or untick a role or group as a whole. Ticked from nothing or from
 * some of its own members, it becomes that role or group; beside other
 * people it adds its members to the list. Unticked (a tick that reads "all",
 * the chapter's included), it goes, or its members leave the list they were
 * in: everyone but Philanthropy.
 */
export function toggleSet(
  who: TaskWho | null,
  set: WhoSet,
  mode: WhoMode,
  directory: WhoDirectory,
): TaskWho | null {
  if (set.memberIds.length === 0) return who;
  const ids = tickedIds(who, directory);
  const members = new Set(set.memberIds);
  const isThis =
    !!who &&
    who.kind !== "person" &&
    who.target.kind === set.kind &&
    who.target.id === set.id;
  if (setTick(set, who, directory) === "all") {
    if (isThis) return null;
    return fromIds(
      ids.filter((id) => !members.has(id)),
      mode,
    );
  }
  if (ids.every((id) => members.has(id))) {
    return { kind: mode, target: { kind: set.kind, id: set.id } };
  }
  return fromIds([...ids, ...set.memberIds.filter((id) => !ids.includes(id))], mode);
}

/** A set's name, or the words for one the picker hasn't read. */
function setName(
  kind: "role" | "group",
  id: string,
  directory: WhoDirectory,
): string {
  return findSet(directory, kind, id)?.name ?? (kind === "role" ? "a role" : "a group");
}

function namesOf(ids: readonly string[], directory: WhoDirectory): string[] {
  return ids.map(
    (id) => findPerson(directory, id)?.name.split(/\s+/)[0] ?? "a member",
  );
}

/**
 * The form's Assign to row: "Sam Lee", "Everyone in Recruitment Committee",
 * "Shawn, Sam and Jimmy", "Someone in Philanthropy Committee", "Anyone in the
 * chapter". `null` for nobody; one person's name is the caller's to say
 * (it knows "You").
 */
export function whoLabel(
  who: TaskWho | null,
  directory: WhoDirectory,
): string | null {
  if (!who) return null;
  if (who.kind === "person") return findPerson(directory, who.userId)?.name ?? null;
  const { target } = who;
  const each = who.kind === "each";
  switch (target.kind) {
    case "chapter":
      return each ? TASK_AUDIENCE_COPY.everyone : TASK_AUDIENCE_COPY.anyone;
    case "role":
    case "group": {
      const name = setName(target.kind, target.id, directory);
      return each
        ? TASK_AUDIENCE_COPY.everyoneIn(name)
        : TASK_AUDIENCE_COPY.someoneIn(name);
    }
    case "people": {
      const names = namesOf(target.userIds, directory);
      return each
        ? TASK_AUDIENCE_COPY.peopleNames(names)
        : TASK_AUDIENCE_COPY.someoneAmong(names);
    }
  }
}

/**
 * The line over the mode, once more than one person is in: "Everyone in the
 * chapter · 24", "Recruitment Committee · 6 members", "Shawn, Sam and Jimmy".
 */
export function whoSummary(
  who: TaskWho | null,
  directory: WhoDirectory,
): string | null {
  if (!who || who.kind === "person") return null;
  const { target } = who;
  const count = whoCount(who, directory);
  switch (target.kind) {
    case "chapter":
      return `${EVERYONE_IN_CHAPTER} · ${count}`;
    case "role":
    case "group":
      return `${setName(target.kind, target.id, directory)} · ${count} ${
        count === 1 ? "member" : "members"
      }`;
    case "people":
      return TASK_AUDIENCE_COPY.peopleNames(
        namesOf(target.userIds, directory),
      );
  }
}

/** The line under the mode: who gets a copy, or that it goes on Up for grabs. */
export function whoHint(
  who: TaskWho | null,
  directory: WhoDirectory,
): string | null {
  if (!who || who.kind === "person") return null;
  const count = whoCount(who, directory);
  if (who.kind === "someone") return TASK_AUDIENCE_COPY.someoneHint(count);
  return who.target.kind === "chapter"
    ? TASK_AUDIENCE_COPY.everyoneHint(count)
    : TASK_AUDIENCE_COPY.eachHint(count);
}

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
  | { kind: "set"; key: string; set: WhoSet; open: boolean };

/** A tier's key for folding, the loose roles' included. */
export function tierKey(tier: WhoTier): string {
  return tier.id ?? "other";
}

/**
 * The tiers that start open: all of them in a chapter with few roles; past
 * {@link TIERS_FOLD_FROM}, only the one holding what is picked (the design's
 * "tiers start collapsed except the one you last used").
 */
export function initialOpenTiers(
  who: TaskWho | null,
  directory: WhoDirectory,
): Set<string> {
  const roles = allRoles(directory);
  if (roles.length <= TIERS_FOLD_FROM) {
    return new Set(directory.tiers.map(tierKey));
  }
  const open = new Set<string>();
  if (who && who.kind !== "person" && who.target.kind === "role") {
    const roleId = who.target.id;
    const tier = directory.tiers.find((each) =>
      each.roles.some((role) => role.id === roleId),
    );
    if (tier) open.add(tierKey(tier));
  }
  return open;
}

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
  },
): WhoRow[] {
  const searching = normalizeWords(options.search).length > 0;
  const personRow = (person: WhoPerson, prefix = "", nested = false): WhoRow => ({
    kind: "person",
    key: `${prefix}person:${person.userId}`,
    person,
    nested,
  });
  if (options.single) {
    return directory.people
      .filter((person) => matchesWordStarts(person.name, options.search))
      .map((person) => personRow(person));
  }
  const setRows = (set: WhoSet): WhoRow[] => {
    const key = `${set.kind}:${set.id}`;
    const open = options.expanded.has(key);
    const rows: WhoRow[] = [{ kind: "set", key, set, open }];
    if (open) {
      for (const userId of set.memberIds) {
        const person = findPerson(directory, userId);
        if (person) rows.push(personRow(person, `${key}:`, true));
      }
    }
    return rows;
  };
  if (searching) {
    const people = directory.people.filter((person) =>
      matchesWordStarts(person.name, options.search),
    );
    const sets = [...allRoles(directory), ...directory.groups].filter((set) =>
      matchesWordStarts(set.name, options.search),
    );
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
      key: `tier:${key}`,
      label: tier.name,
      tierKey: key,
      open,
    });
    if (open) rows.push(...tier.roles.flatMap(setRows));
  }
  if (directory.groups.length > 0) {
    rows.push({ kind: "heading", key: "h:groups", label: GROUPS_HEADING });
    rows.push(...directory.groups.flatMap(setRows));
  }
  return rows;
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
