/**
 * The Who picker's rules, for web's popover (`apps/web/components/tasks/
 * who-picker.tsx`) and the phone's Assign to sheet (`apps/mobile/components/
 * tasks/who-picker-sheet.tsx`) alike (Paul, 2026-11-18; `spec/behavior/
 * tasks.md` § The Who picker). One copy, because the two apps drifting apart on what a
 * tick means is how the same pick would make different tasks.
 *
 * The chapter reads as a tree: everyone in it at the top, then its roles
 * (under their tiers, in the chapter's order, then roles outside every tier)
 * and its groups, down to the people in each. People are a tick each; a role
 * or group is ticked whole. Once more than one person is in, the pick says
 * whether each of them does it (a copy each) or one of them claims it (Up for
 * grabs).
 *
 * Pure, with no React and no request: each app reads the chapter with its own
 * hooks and hands the rows to {@link buildWhoDirectory}. The value is a
 * `TaskWho` (`@repo/validation`), which also turns it into the create
 * (`taskWhoRequest`). Every word for a pick comes from `TASK_AUDIENCE_COPY`.
 *
 * ## What a tick does
 *
 * Whatever the value is (the chapter, a role, a group, a list), the ticks
 * read it as the active members it reaches.
 *
 * - Ticking a person adds them; unticking one takes them out, so unticking a
 *   member of a ticked role, group or the chapter narrows to a list of the
 *   rest. Every active member ticked one by one is the chapter.
 * - Ticking a role or group while the pick is the chapter switches to it: the
 *   tree narrows from the chapter down. Ticked from nothing, or from some of
 *   its own members, it becomes that role or group, kept as itself so a
 *   committee's task follows who's in it when someone claims it. Ticked
 *   beside other people, it adds its members to the list.
 * - Unticking a role or group that is the pick clears it; unticking one whose
 *   members are all in a wider pick takes them out of it.
 * - A role or group nobody active holds can't be ticked.
 * - The mode (each or someone) belongs to the picker, not to one value: one
 *   person has none, so the picker holds the last mode
 *   ({@link pickerMode}) and every toggle takes it, and going down to one
 *   person and back up keeps it.
 */

import { memberLabel } from "./display-names";
import { matchesWordStarts } from "./fuzzy-match";
import {
  byDisplayOrder,
  normalizeTieredRoles,
  normalizeTiers,
  type TieredRole,
} from "./role-tiers";
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
  /** Their name, or the shared fallback ("Member 2f4a1c") when they set none. */
  name: string;
  /** Whether they set a name: an unnamed viewer still reads "You". */
  named: boolean;
  avatarUrl: string | null;
  isViewer: boolean;
}

/**
 * A role, chapter group or tier (#5473), with the active members it reaches
 * now: a tier reaches everyone holding a role in it.
 */
export interface WhoSet {
  kind: "role" | "group" | "tier";
  id: string;
  name: string;
  /** Its active members' ids, in {@link WhoDirectory.people}'s order. */
  memberIds: string[];
}

/** A tier heading and its roles, in the chapter's own order. */
export interface WhoTier {
  /** `null` for the roles outside every tier, listed after the tiers. */
  id: string | null;
  name: string;
  roles: WhoSet[];
  /**
   * The tier itself as something to pick (#5473): everyone holding a role in
   * it. `null` for the roles outside every tier.
   */
  set: WhoSet | null;
  /**
   * The tier holds the chapter's Everyone role, so it reaches the chapter:
   * the API refuses it as what a task is from (#5473), as it does the role.
   */
  holdsEveryone: boolean;
}

/** The chapter as the picker draws it. */
export interface WhoDirectory {
  /** Active members, the viewer first, then by name. Alumni left out. */
  people: WhoPerson[];
  byId: ReadonlyMap<string, WhoPerson>;
  /** Tiers with roles, then the roles in no tier ({@link OTHER_ROLES_HEADING}). */
  tiers: WhoTier[];
  groups: WhoSet[];
  /** Every role, group and tier by id. */
  sets: ReadonlyMap<string, WhoSet>;
  /** Every active member's id, in {@link people}'s order. */
  activeIds: string[];
}

/** A member read off `GET /v1/members`, or the roster when that isn't there. */
export interface WhoMemberSource {
  user_id?: string | null;
  display_name?: string | null;
  avatar_url?: string | null;
  role_ids?: readonly string[] | null;
  is_alumni?: boolean | null;
}

/** A group read off `GET /v1/groups`. */
export interface WhoGroupSource {
  id: string;
  name: string;
  /** `manual`, or an automatic kind (a class year…). */
  kind?: string | null;
  member_ids: readonly string[];
}

/** The Alumni role's rename-proof key: a task can't go to it. */
const ALUMNI_ROLE_KEY = "ALUMNI";

/** The heading for roles in no tier, after the chapter's own tiers. */
export const OTHER_ROLES_HEADING = "Other roles";
/** The same roles' heading in a chapter with no tiers at all. */
export const ROLES_HEADING = "Roles";
/** The heading over the chapter's groups. */
export const GROUPS_HEADING = "Groups";
/** The row at the top of the tree. */
export const EVERYONE_IN_CHAPTER = TASK_AUDIENCE_COPY.everyoneIn("the chapter");
/** A role or group nobody active holds, greyed. */
export const NOBODY_YET = "Nobody yet";

/** The words on the picker's controls, beside `TASK_AUDIENCE_COPY`'s. */
export const WHO_PICKER_COPY = {
  title: "Assign to",
  search: "Search people, roles and groups",
  searchPeople: "Search people",
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

/** A chapter with more roles than this starts its tiers folded. */
export const TIERS_FOLD_FROM = 12;

/**
 * The directory from the chapter's reads. `members` (`GET /v1/members`)
 * carries alumni and role holders; without it (still loading, or refused)
 * the roster stands in for the people, and roles count nobody. The Everyone
 * role is the chapter row, so it is left out of the roles; the Alumni role is
 * too, since alumni never get a task. A role or group keeps only its active
 * members, and an automatic group nobody is in is left out (the API's rule),
 * while an empty manual one shows, greyed, so it doesn't silently make
 * nothing.
 */
export function buildWhoDirectory(input: {
  members?: readonly WhoMemberSource[] | null;
  roster?: readonly WhoMemberSource[] | null;
  roles?: unknown;
  tiers?: unknown;
  groups?: readonly WhoGroupSource[] | null;
  viewerUserId: string | null | undefined;
}): WhoDirectory {
  const source = input.members ?? input.roster ?? [];
  const seen = new Set<string>();
  const people: WhoPerson[] = [];
  const roleIdsOf = new Map<string, readonly string[]>();
  for (const row of source) {
    const userId = row.user_id ? String(row.user_id) : "";
    if (!userId || seen.has(userId) || row.is_alumni === true) continue;
    seen.add(userId);
    const name = memberLabel(row.display_name, userId);
    people.push({
      userId,
      name,
      named: typeof row.display_name === "string" && row.display_name.trim() !== "",
      avatarUrl: row.avatar_url ?? null,
      isViewer: userId === input.viewerUserId,
    });
    roleIdsOf.set(userId, row.role_ids ?? []);
  }
  people.sort(
    (a, b) =>
      Number(b.isViewer) - Number(a.isViewer) || a.name.localeCompare(b.name),
  );
  const activeIds = people.map((person) => person.userId);
  const sets = new Map<string, WhoSet>();

  const roles = normalizeTieredRoles(input.roles)
    .filter(
      (role) => !isEveryoneRole(role) && role.system_key !== ALUMNI_ROLE_KEY,
    )
    .sort(byDisplayOrder);
  const asSet = (role: TieredRole): WhoSet => {
    const set: WhoSet = {
      kind: "role",
      id: role.id,
      name: role.name.trim() || "Unnamed role",
      memberIds: activeIds.filter((userId) =>
        roleIdsOf.get(userId)?.includes(role.id),
      ),
    };
    sets.set(set.id, set);
    return set;
  };
  const tierRows = normalizeTiers(input.tiers);
  const known = new Set(tierRows.map((tier) => tier.id));
  // A tier reaches everyone holding a role in it, and the whole chapter when
  // it holds the Everyone role, as the API reads it (#5473).
  const everyRole = normalizeTieredRoles(input.roles);
  const tierSet = (id: string, name: string, roleSets: WhoSet[]): WhoSet => {
    const everyone = everyRole.some(
      (role) => role.tier_id === id && isEveryoneRole(role),
    );
    const held = new Set(roleSets.flatMap((role) => role.memberIds));
    const set: WhoSet = {
      kind: "tier",
      id,
      name: name.trim() || "Unnamed tier",
      memberIds: everyone
        ? activeIds
        : activeIds.filter((userId) => held.has(userId)),
    };
    sets.set(set.id, set);
    return set;
  };
  const tiers: WhoTier[] = tierRows
    .map((tier) => {
      const tierRoles = roles
        .filter((role) => role.tier_id === tier.id)
        .map(asSet);
      return {
        id: tier.id,
        name: tier.name,
        roles: tierRoles,
        set: tierRoles.length > 0 ? tierSet(tier.id, tier.name, tierRoles) : null,
        holdsEveryone: everyRole.some(
          (role) => role.tier_id === tier.id && isEveryoneRole(role),
        ),
      };
    })
    .filter((tier) => tier.roles.length > 0);
  const loose = roles.filter(
    (role) => !role.tier_id || !known.has(role.tier_id),
  );
  if (loose.length > 0) {
    tiers.push({
      id: null,
      name: tiers.length > 0 ? OTHER_ROLES_HEADING : ROLES_HEADING,
      roles: loose.map(asSet),
      set: null,
      holdsEveryone: false,
    });
  }

  const groups: WhoSet[] = (input.groups ?? []).flatMap((group) => {
    const memberIds = activeIds.filter((userId) =>
      group.member_ids.includes(userId),
    );
    if (memberIds.length === 0 && group.kind && group.kind !== "manual") {
      return [];
    }
    const set: WhoSet = { kind: "group", id: group.id, name: group.name, memberIds };
    sets.set(set.id, set);
    return [set];
  });

  return {
    people,
    byId: new Map(people.map((person) => [person.userId, person])),
    tiers,
    groups,
    sets,
    activeIds,
  };
}

/** Every role in the directory, tier by tier. */
export function allRoles(directory: WhoDirectory): WhoSet[] {
  return directory.tiers.flatMap((tier) => tier.roles);
}

/** A tier's key for folding, the roles in no tier's included. */
export function tierKey(tier: WhoTier): string {
  return tier.id ?? "other";
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
    case "tier":
      return directory.sets.get(target.id)?.memberIds ?? [];
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

/** Each does it (a copy each), or one of them claims it (Up for grabs). */
export type WhoMode = "each" | "someone";

/** A value's own mode; one person (or nobody) reads as "each". */
export function whoMode(who: TaskWho | null): WhoMode {
  return who?.kind === "someone" ? "someone" : "each";
}

/** Whether a value is more than one person, so the mode means something. */
export function isGroupWho(who: TaskWho | null): boolean {
  return !!who && who.kind !== "person";
}

/**
 * The mode the picker shows and toggles with: the value's own once it is
 * more than one person, otherwise the one the picker held from before, so
 * going down to one person and back up keeps the answer.
 */
export function pickerMode(who: TaskWho | null, held: WhoMode): WhoMode {
  return isGroupWho(who) ? whoMode(who) : held;
}

/** A value with its mode set; one person has none. */
export function withMode(who: TaskWho | null, mode: WhoMode): TaskWho | null {
  if (!who || who.kind === "person") return who;
  return { kind: mode, target: who.target };
}

function isPickedSet(
  who: TaskWho | null,
  kind: "role" | "group" | "tier" | "chapter",
  id?: string,
): boolean {
  if (!who || who.kind === "person") return false;
  const { target } = who;
  if (target.kind !== kind) return false;
  return kind === "chapter" || ("id" in target && target.id === id);
}

/**
 * A set of people as a value: nobody is null, one is that person, every
 * active member (more than one) is the chapter, otherwise those people.
 */
export function whoFromIds(
  ids: readonly string[],
  mode: WhoMode,
  directory: WhoDirectory,
): TaskWho | null {
  const unique = [...new Set(ids)];
  if (
    unique.length > 1 &&
    unique.length === directory.activeIds.length &&
    directory.activeIds.every((id) => unique.includes(id))
  ) {
    return { kind: mode, target: { kind: "chapter" } };
  }
  return normalizeTaskWho({
    kind: mode,
    target: { kind: "people", userIds: unique },
  });
}

/** A tick's three states: on, partly on (some of a set), off. */
export type Tick = "all" | "some" | "none";

/** A tick as `aria-checked` and React Native's `checked` read it. */
export function tickChecked(tick: Tick): boolean | "mixed" {
  return tick === "all" ? true : tick === "some" ? "mixed" : false;
}

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
  if (isPickedSet(who, "chapter")) return "all";
  return tickOf(directory.activeIds, new Set(tickedIds(who, directory)));
}

/** A role's or group's tick: all of its members in, some, or none. */
export function setTick(
  who: TaskWho | null,
  set: WhoSet,
  directory: WhoDirectory,
): Tick {
  return tickOf(set.memberIds, new Set(tickedIds(who, directory)));
}

/** Whether one person is ticked. */
export function personTicked(
  who: TaskWho | null,
  userId: string,
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
  return whoFromIds(
    ids.includes(userId) ? ids.filter((id) => id !== userId) : [...ids, userId],
    mode,
    directory,
  );
}

/** Tick everyone in the chapter, or untick it when it is all ticked. */
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
 * Tick or untick a role or group as a whole (the rules in this file's
 * header): nobody in it does nothing; the pick itself clears; from the
 * chapter it switches to it; from nothing or some of its own members it
 * becomes it; all of it inside a wider pick takes its members out; beside
 * other people it adds its members.
 */
export function toggleSet(
  who: TaskWho | null,
  set: WhoSet,
  mode: WhoMode,
  directory: WhoDirectory,
): TaskWho | null {
  if (set.memberIds.length === 0) return who;
  if (isPickedSet(who, set.kind, set.id)) return null;
  const asSet: TaskWho = { kind: mode, target: { kind: set.kind, id: set.id } };
  if (isPickedSet(who, "chapter")) return asSet;
  const ids = tickedIds(who, directory);
  const members = new Set(set.memberIds);
  if (setTick(who, set, directory) === "all") {
    return whoFromIds(
      ids.filter((id) => !members.has(id)),
      mode,
      directory,
    );
  }
  if (ids.every((id) => members.has(id))) return asSet;
  return whoFromIds(
    [...ids, ...set.memberIds.filter((id) => !ids.includes(id))],
    mode,
    directory,
  );
}

/** A person's name, or the shared fallback for one not on the roster. */
export function personName(userId: string, directory: WhoDirectory): string {
  return directory.byId.get(userId)?.name ?? memberLabel(null, userId);
}

function firstNames(ids: readonly string[], directory: WhoDirectory): string[] {
  return ids.map((id) => {
    const name = personName(id, directory);
    return name.split(/\s+/)[0] || name;
  });
}

/** A set's name, or the words for one the picker hasn't read. */
function setName(
  kind: "role" | "group" | "tier",
  id: string,
  directory: WhoDirectory,
): string {
  return (
    directory.sets.get(id)?.name ??
    (kind === "role" ? "a role" : kind === "tier" ? "a tier" : "a group")
  );
}

/**
 * The pick in a few words, for a trigger or the form's row: "Sam Lee",
 * "Everyone in Recruitment Committee", "Shawn, Sam and Jimmy", "Someone in
 * Philanthropy", "Anyone in the chapter". `null` for nobody.
 */
export function whoLabel(
  who: TaskWho | null,
  directory: WhoDirectory,
): string | null {
  if (!who) return null;
  if (who.kind === "person") return personName(who.userId, directory);
  const { target } = who;
  const each = who.kind === "each";
  switch (target.kind) {
    case "chapter":
      return each ? TASK_AUDIENCE_COPY.everyone : TASK_AUDIENCE_COPY.anyone;
    case "role":
    case "group":
    case "tier": {
      const name = setName(target.kind, target.id, directory);
      return each
        ? TASK_AUDIENCE_COPY.everyoneIn(name)
        : TASK_AUDIENCE_COPY.someoneIn(name);
    }
    case "people": {
      const names = firstNames(target.userIds, directory);
      return each
        ? TASK_AUDIENCE_COPY.peopleNames(names)
        : TASK_AUDIENCE_COPY.someoneAmong(names);
    }
  }
}

/**
 * The line over the mode, once more than one person is in: "Everyone in the
 * chapter · 24", "Recruitment Committee · 6 members", "Shawn, Sam and
 * Jimmy", or "5 of Recruitment Committee" for a list narrowed from a role or
 * group the member opened (`narrowedFrom`).
 */
export function whoSummary(
  who: TaskWho | null,
  directory: WhoDirectory,
  narrowedFrom?: WhoSet | null,
): string | null {
  if (!who || who.kind === "person") return null;
  const { target } = who;
  const count = whoCount(who, directory);
  switch (target.kind) {
    case "chapter":
      return `${EVERYONE_IN_CHAPTER} · ${count}`;
    case "role":
    case "group":
    case "tier":
      return `${setName(target.kind, target.id, directory)} · ${count} ${
        count === 1 ? "member" : "members"
      }`;
    case "people":
      if (
        narrowedFrom &&
        target.userIds.every((id) => narrowedFrom.memberIds.includes(id))
      ) {
        return `${count} of ${narrowedFrom.name}`;
      }
      return TASK_AUDIENCE_COPY.peopleNames(
        firstNames(target.userIds, directory),
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

/**
 * Whether a person's, role's or group's name matches a search: every word
 * typed starts a word of it, as the other role and member pickers match.
 */
export function whoMatches(name: string, query: string): boolean {
  return matchesWordStarts(name, query);
}

/**
 * The tiers that start open, by {@link tierKey}: all of them in a chapter
 * with {@link TIERS_FOLD_FROM} roles or fewer; past that, only the ones
 * holding a role the pick takes whole (the design's "tiers start collapsed
 * except the one you last used"), so a hundred roles don't bury the pick.
 */
export function initialOpenTiers(
  who: TaskWho | null,
  directory: WhoDirectory,
): Set<string> {
  if (allRoles(directory).length <= TIERS_FOLD_FROM) {
    return new Set(directory.tiers.map(tierKey));
  }
  const open = new Set<string>();
  if (!who || who.kind === "person" || who.target.kind === "chapter") {
    return open;
  }
  const { target } = who;
  for (const tier of directory.tiers) {
    const holds =
      (target.kind === "tier" && tier.id === target.id) ||
      tier.roles.some((role) =>
        target.kind === "role"
          ? role.id === target.id
          : target.kind === "people" && setTick(who, role, directory) === "all",
      );
    if (holds) open.add(tierKey(tier));
  }
  return open;
}

/** The tab a picker opens on: Roles and groups when the pick is one. */
export function initialWhoTab(who: TaskWho | null): "people" | "sets" {
  return who &&
    who.kind !== "person" &&
    (who.target.kind === "role" ||
      who.target.kind === "group" ||
      who.target.kind === "tier")
    ? "sets"
    : "people";
}
