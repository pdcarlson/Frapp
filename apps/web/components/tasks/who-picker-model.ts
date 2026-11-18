import {
  TASK_AUDIENCE_COPY,
  isEveryoneRole,
  normalizeTaskWho,
  type TaskWho,
  type TaskWhoTarget,
} from "@repo/validation";
import { memberLabel } from "@repo/hooks/display-names";
import {
  byDisplayOrder,
  normalizeTieredRoles,
  normalizeTiers,
} from "@repo/hooks/role-tiers";

/*
 * The Who picker's model (Paul, 2026-11-18): the chapter read as a tree, from
 * everyone in it down through its roles (grouped under their tiers, the way
 * Settings lists them) and its groups, to the people in each. Pure, so the
 * picker's rules are specced without a popover: what a tick means, what the
 * picker reads back, and the words it says for a pick.
 */

/** One active member, as the picker lists them. */
export interface WhoPerson {
  userId: string;
  name: string;
  avatarUrl: string | null;
  isViewer: boolean;
}

/** A role or a chapter group, as the picker lists it. */
export interface WhoSet {
  kind: "role" | "group";
  id: string;
  name: string;
  /** Its active members' ids, in the roster's order. */
  memberIds: string[];
}

export interface WhoTier {
  id: string;
  name: string;
  roles: WhoSet[];
}

/** Everything the picker draws, read once from the chapter's lists. */
export interface WhoDirectory {
  /** Active members by name, the viewer first. Alumni are never here. */
  people: WhoPerson[];
  byId: Map<string, WhoPerson>;
  tiers: WhoTier[];
  /** Roles outside every tier, after the tiers. */
  untiered: WhoSet[];
  groups: WhoSet[];
  /** Every role and group by id, for the summary line. */
  sets: Map<string, WhoSet>;
}

type MemberRow = {
  user_id?: string | null;
  display_name?: string | null;
  avatar_url?: string | null;
  is_alumni?: boolean | null;
  role_ids?: readonly string[] | null;
};

type GroupRow = { id: string; name: string; member_ids: readonly string[] };

/**
 * The chapter as the picker reads it. The Everyone role is the chapter row,
 * so it is left out of the roles; the Alumni role is too, since alumni never
 * get a task. A role or group keeps only its active members.
 */
export function buildWhoDirectory({
  members,
  roles,
  tiers,
  groups,
  viewerId,
}: {
  members: readonly MemberRow[] | undefined;
  roles: unknown;
  tiers: unknown;
  groups: readonly GroupRow[] | undefined;
  viewerId: string | null | undefined;
}): WhoDirectory {
  const seen = new Set<string>();
  const people: WhoPerson[] = [];
  const roleMembers = new Map<string, string[]>();
  for (const member of members ?? []) {
    const userId = member.user_id ? String(member.user_id) : "";
    if (!userId || member.is_alumni || seen.has(userId)) continue;
    seen.add(userId);
    people.push({
      userId,
      name: memberLabel(member.display_name, userId),
      avatarUrl: member.avatar_url ?? null,
      isViewer: userId === viewerId,
    });
    for (const roleId of member.role_ids ?? []) {
      roleMembers.set(roleId, [...(roleMembers.get(roleId) ?? []), userId]);
    }
  }
  people.sort((a, b) =>
    a.isViewer !== b.isViewer
      ? a.isViewer
        ? -1
        : 1
      : a.name.localeCompare(b.name),
  );
  const order = new Map(people.map((person, index) => [person.userId, index]));
  const inOrder = (ids: Iterable<string>) =>
    [...new Set(ids)]
      .filter((id) => order.has(id))
      .sort((a, b) => order.get(a)! - order.get(b)!);

  const sets = new Map<string, WhoSet>();
  const tierRows = normalizeTiers(tiers);
  const tierById = new Map<string, WhoTier>(
    tierRows.map((tier) => [tier.id, { id: tier.id, name: tier.name, roles: [] }]),
  );
  const untiered: WhoSet[] = [];
  for (const role of [...normalizeTieredRoles(roles)].sort(byDisplayOrder)) {
    if (isEveryoneRole(role) || role.system_key === "ALUMNI") {
      continue;
    }
    const set: WhoSet = {
      kind: "role",
      id: role.id,
      name: role.name,
      memberIds: inOrder(roleMembers.get(role.id) ?? []),
    };
    sets.set(set.id, set);
    const tier = role.tier_id ? tierById.get(role.tier_id) : undefined;
    (tier ? tier.roles : untiered).push(set);
  }
  const groupSets: WhoSet[] = (groups ?? []).map((group) => ({
    kind: "group",
    id: group.id,
    name: group.name,
    memberIds: inOrder(group.member_ids),
  }));
  for (const group of groupSets) sets.set(group.id, group);
  return {
    people,
    byId: new Map(people.map((person) => [person.userId, person])),
    tiers: tierRows
      .map((tier) => tierById.get(tier.id)!)
      .filter((tier) => tier.roles.length > 0),
    untiered,
    groups: groupSets,
    sets,
  };
}

/** Whether a pick gives each person a copy or offers one task to claim. */
export type WhoMode = "each" | "someone";

/** The ids a pick reaches now, in the roster's order. */
export function includedIds(
  who: TaskWho | null,
  directory: WhoDirectory,
): string[] {
  if (!who) return [];
  if (who.kind === "person") return [who.userId];
  return targetIds(who.target, directory);
}

function targetIds(target: TaskWhoTarget, directory: WhoDirectory): string[] {
  switch (target.kind) {
    case "chapter":
      return directory.people.map((person) => person.userId);
    case "role":
    case "group":
      return directory.sets.get(target.id)?.memberIds ?? [];
    case "people":
      return target.userIds;
  }
}

export function modeOf(who: TaskWho | null): WhoMode {
  return who?.kind === "someone" ? "someone" : "each";
}

/**
 * A set of people as a pick: nobody is null, one is that person, everyone
 * active is the chapter, otherwise those people.
 */
export function whoFromIds(
  ids: readonly string[],
  mode: WhoMode,
  directory: WhoDirectory,
): TaskWho | null {
  const unique = [...new Set(ids)];
  if (
    unique.length > 1 &&
    unique.length === directory.people.length &&
    directory.people.every((person) => unique.includes(person.userId))
  ) {
    return { kind: mode, target: { kind: "chapter" } };
  }
  return normalizeTaskWho({
    kind: mode,
    target: { kind: "people", userIds: unique },
  });
}

/** Tick or untick one person: the people the pick reaches, plus or minus them. */
export function togglePerson(
  who: TaskWho | null,
  userId: string,
  directory: WhoDirectory,
): TaskWho | null {
  const ids = includedIds(who, directory);
  const next = ids.includes(userId)
    ? ids.filter((id) => id !== userId)
    : [...ids, userId];
  return whoFromIds(next, modeOf(who), directory);
}

/** Tick a role or group whole, or untick it when it is the pick. */
export function toggleSet(
  who: TaskWho | null,
  set: WhoSet,
): TaskWho | null {
  if (who && who.kind !== "person" && who.target.kind === set.kind && who.target.id === set.id) {
    return null;
  }
  return normalizeTaskWho({
    kind: modeOf(who),
    target: { kind: set.kind, id: set.id },
  });
}

/** Tick the chapter, or untick it when it is the pick. */
export function toggleChapter(who: TaskWho | null): TaskWho | null {
  if (who && who.kind !== "person" && who.target.kind === "chapter") {
    return null;
  }
  return { kind: modeOf(who), target: { kind: "chapter" } };
}

/** The same people, each doing it or one of them claiming it. */
export function withMode(who: TaskWho | null, mode: WhoMode): TaskWho | null {
  if (!who || who.kind === "person") return who;
  return { kind: mode, target: who.target };
}

/** How a role or group row's box reads: all of it, some of it, or none. */
export function setTick(
  who: TaskWho | null,
  set: WhoSet,
  directory: WhoDirectory,
): boolean | "mixed" {
  if (who && who.kind !== "person" && who.target.kind === set.kind) {
    if (who.target.id === set.id) return true;
  }
  if (who?.kind !== "person" && who?.target.kind === "chapter") {
    return set.memberIds.length > 0;
  }
  const ids = new Set(includedIds(who, directory));
  const inSet = set.memberIds.filter((id) => ids.has(id)).length;
  if (inSet === 0) return false;
  return inSet === set.memberIds.length ? true : "mixed";
}

/** The pick's role or group, when it is one. */
function pickedSet(
  who: TaskWho | null,
  directory: WhoDirectory,
): WhoSet | undefined {
  if (!who || who.kind === "person") return undefined;
  const { target } = who;
  return target.kind === "role" || target.kind === "group"
    ? directory.sets.get(target.id)
    : undefined;
}

/** A person's name, or the shared fallback for one not on the roster. */
export function personName(userId: string, directory: WhoDirectory): string {
  const person = directory.byId.get(userId);
  if (!person) return memberLabel(null, userId);
  return person.name;
}

/**
 * The pick in a few words, for the trigger and the footer: "Shawn Klein",
 * "Shawn, Sam and Jimmy", "Everyone in Recruitment Committee",
 * "Someone in Recruitment Committee", "Anyone in the chapter".
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
    case "group": {
      const name = directory.sets.get(target.id)?.name ?? "a role";
      return each
        ? TASK_AUDIENCE_COPY.everyoneIn(name)
        : TASK_AUDIENCE_COPY.someoneIn(name);
    }
    case "people": {
      const names = target.userIds.map((id) => firstName(personName(id, directory)));
      return each
        ? TASK_AUDIENCE_COPY.peopleNames(names)
        : TASK_AUDIENCE_COPY.someoneAmong(names);
    }
  }
}

function firstName(name: string): string {
  return name.split(/\s+/)[0] ?? name;
}

/**
 * The picker's footer line, once more than one person is in: "Shawn, Sam
 * and Jimmy", "Recruitment Committee · 6 members", "5 of Recruitment
 * Committee" (narrowed from a role or group the member opened), "Everyone in
 * the chapter · 24".
 */
export function whoSummary(
  who: TaskWho | null,
  directory: WhoDirectory,
  narrowedFrom?: WhoSet | null,
): string | null {
  if (!who || who.kind === "person") return null;
  const { target } = who;
  const count = includedIds(who, directory).length;
  if (target.kind === "chapter") return `Everyone in the chapter · ${count}`;
  const set = pickedSet(who, directory);
  if (set) return `${set.name} · ${membersWord(set.memberIds.length)}`;
  if (target.kind !== "people") return whoLabel(who, directory);
  if (
    narrowedFrom &&
    target.userIds.every((id) => narrowedFrom.memberIds.includes(id))
  ) {
    return `${count} of ${narrowedFrom.name}`;
  }
  return TASK_AUDIENCE_COPY.peopleNames(
    target.userIds.map((id) => firstName(personName(id, directory))),
  );
}

function membersWord(count: number): string {
  return count === 1 ? "1 member" : `${count} members`;
}

/** The hint under the mode switch: who gets what. */
export function whoHint(
  who: TaskWho | null,
  directory: WhoDirectory,
): string | null {
  if (!who || who.kind === "person") return null;
  const count = includedIds(who, directory).length;
  if (who.kind === "someone") return TASK_AUDIENCE_COPY.someoneHint(count);
  return who.target.kind === "chapter"
    ? TASK_AUDIENCE_COPY.everyoneHint(count)
    : TASK_AUDIENCE_COPY.eachHint(count);
}

/** Words a search matches: a name's word starts, as the other pickers do. */
export function matchesSearch(name: string, query: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const nameWords = name.toLowerCase().split(/[\s\-_/,.()]+/).filter(Boolean);
  return words.every((word) =>
    nameWords.some((nameWord) => nameWord.startsWith(word)),
  );
}

/** The tiers and groups that hold part of the pick, to open on. */
export function openSections(
  who: TaskWho | null,
  directory: WhoDirectory,
): Set<string> {
  const open = new Set<string>();
  // With no tiers, the roles are one short list: folding it hides them all.
  if (directory.tiers.length === 0) open.add("tier:none");
  if (!who || who.kind === "person" || who.target.kind === "chapter") {
    return open;
  }
  const holds = (sets: WhoSet[]) =>
    sets.some((set) => setTick(who, set, directory) !== false);
  for (const tier of directory.tiers) {
    if (holds(tier.roles)) open.add(`tier:${tier.id}`);
  }
  if (holds(directory.untiered)) open.add("tier:none");
  if (holds(directory.groups)) open.add("groups");
  return open;
}
