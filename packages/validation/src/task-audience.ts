/**
 * Who a task is for when it isn't one person (#4295 step 3; Paul, 2026-11-17:
 * "can we make tasks assignable to everyone?", and he picked "one group task,
 * a copy each"). `spec/behavior/tasks.md` § Tasks for everyone.
 *
 * `everyone` is the chapter's active members, alumni left out
 * (`spec/behavior/alumni.md`): each gets their own copy of the task, with its
 * own progress, proof and points, and the board shows the group as one tile,
 * "14 of 20 done". Sent as `audience` on `POST /v1/tasks` in place of
 * `assignee_id`, and on a suggested task's payload beside it.
 */
export const TASK_AUDIENCE_EVERYONE = "everyone";

export const TASK_AUDIENCES = [TASK_AUDIENCE_EVERYONE] as const;

export type TaskAudience = (typeof TASK_AUDIENCES)[number];

/**
 * Who a group task went to, as task reads carry it (`group.audience`, Paul,
 * 2026-11-18): the chapter (`everyone`), several people picked one by one
 * (`people`), a role's holders (`role`), a chapter group's members
 * (`group`), or everyone holding a role in a tier (`tier`, #5473). Each of
 * them got their own copy. A request still sends `audience: "everyone"`,
 * narrowed by `audience_role_id`, `audience_group_id` or `audience_tier_id`,
 * or `assignee_ids` for several people.
 */
export const TASK_GROUP_AUDIENCES = [
  TASK_AUDIENCE_EVERYONE,
  "people",
  "role",
  "group",
  "tier",
] as const;

export type TaskGroupAudience = (typeof TASK_GROUP_AUDIENCES)[number];

/**
 * `someone`: one member out of a set takes the task, from Up for grabs
 * (`open_tasks`), instead of everyone getting a copy. A suggested task's
 * payload carries it in `audience` beside `everyone`.
 */
export const TASK_AUDIENCE_SOMEONE = "someone";

/** What a suggested task's `audience` may hold (2026-11-18). */
export const TASK_SUGGESTION_AUDIENCES = [
  TASK_AUDIENCE_EVERYONE,
  TASK_AUDIENCE_SOMEONE,
] as const;

export type TaskSuggestionAudience = (typeof TASK_SUGGESTION_AUDIENCES)[number];

/** Who may claim a task up for grabs (`open_tasks.scope`). */
export const OPEN_TASK_SCOPES = [
  "chapter",
  "role",
  "group",
  "people",
  "tier",
] as const;

export type OpenTaskScope = (typeof OPEN_TASK_SCOPES)[number];

/** Most people a task can be given to one by one, or offered among. */
export const TASK_PEOPLE_MAX = 500;

/** Whether a value is one of {@link TASK_AUDIENCES}. */
export function isTaskAudience(value: unknown): value is TaskAudience {
  return (
    typeof value === "string" &&
    (TASK_AUDIENCES as readonly string[]).includes(value)
  );
}

/** The words every surface uses for a group task or a task up for grabs. */
export const TASK_AUDIENCE_COPY = {
  /** The option in a Who or Assignee picker, and a group tile's who. */
  everyone: "Everyone",
  /** A group task for a role's holders or a group's members (2026-11-18). */
  everyoneIn: (name: string) => `Everyone in ${name}`,
  /** A group task for several people picked one by one. */
  people: (count: number) => (count === 1 ? "1 person" : `${count} people`),
  /** The same, by name: "Sam", "Sam and Alex", "Sam, Alex and 3 others". */
  peopleNames: (names: readonly string[]) => listNames(names),
  /** A task up for grabs for a role's holders or a group's members. */
  someoneIn: (name: string) => `Someone in ${name}`,
  /** A task up for grabs for anyone in the chapter. */
  anyone: "Anyone in the chapter",
  /** A task up for grabs for one of several people. */
  someoneAmong: (names: readonly string[]) => `One of ${listNames(names)}`,
  /** The board section and the picker's word for open tasks. */
  upForGrabs: "Up for grabs",
  /** A member takes an open task. */
  claim: "Claim",
  /** The assignee gives a claimed task back to Up for grabs. */
  release: "Give it back",
  /** An officer hands an open task to one member. */
  assignToSomeone: "Assign to someone",
  /** Refused claim: another member got there first (the API's 409). */
  alreadyClaimed: "Someone already claimed this",
  /** Refused: the role, group or chapter has nobody in it to give it to. */
  nobodyInRole: "Nobody holds that role yet",
  nobodyInGroup: "Nobody is in that group yet",
  nobodyInTier: "Nobody holds a role in that tier yet",
  nobodyInChapter: "This chapter has no active members yet",
  /** Under the picker once Everyone is chosen. */
  everyoneHint: (count: number | null) =>
    count === null
      ? "Each active member gets their own copy."
      : count === 1
        ? "1 active member gets their own copy."
        : `Each of ${count} active members gets their own copy.`,
  /** Under the picker for a copy each to a role, group or several people. */
  eachHint: (count: number) =>
    count === 1
      ? "1 member gets their own copy."
      : `Each of ${count} members gets their own copy.`,
  /** Under the picker for a task up for grabs. */
  someoneHint: (count: number) =>
    count === 1
      ? "1 member can take it. It goes on Up for grabs."
      : `One of ${count} members takes it. It goes on Up for grabs.`,
  /** A group tile's progress line: "14 of 20 done". */
  progress: (done: number, total: number) => `${done} of ${total} done`,
  /**
   * Who a group task went to and how far its copies are, on one line:
   * "Everyone · 14 of 20 done" (#5699). A copy's row and panel on web and the
   * phone's row and task screen all say it this way; `who` null gives the
   * count alone.
   */
  groupLine: (who: string | null, done: number, total: number) =>
    [who, `${done} of ${total} done`].filter(Boolean).join(" · "),
  /** Why a group task can't repeat or carry photos yet. */
  noRepeat: "A task for everyone can't repeat yet.",
  noPhotos: "A task for everyone can't carry photos yet.",
} as const;

/** "Sam", "Sam and Alex", "Sam, Alex and Jo", "Sam, Alex and 3 others". */
function listNames(names: readonly string[]): string {
  const [first, second, third, ...rest] = names
    .map((name) => name.trim())
    .filter(Boolean);
  if (first === undefined) return "nobody";
  if (second === undefined) return first;
  if (third === undefined) return `${first} and ${second}`;
  if (rest.length === 0) return `${first}, ${second} and ${third}`;
  return `${first}, ${second} and ${rest.length + 1} others`;
}

/**
 * How far along a group task is (#4295 step 3), counted over its copies.
 * `done` counts every copy whose member has marked it done, confirmed or
 * still waiting on an officer; `confirmed` only the ones an officer signed
 * off (or that needed no sign-off).
 */
export interface TaskGroupProgress {
  total: number;
  done: number;
  confirmed: number;
}

/**
 * How many copies a task for everyone would make from a member list: the
 * members with an account, alumni left out, as the API counts them.
 */
export function everyoneCount(
  members: readonly { user_id?: string | null; is_alumni?: boolean | null }[],
): number {
  return new Set(
    members
      .filter((member) => member.user_id && !member.is_alumni)
      .map((member) => member.user_id),
  ).size;
}

/**
 * Whom a task is for, as a picker holds it (Paul, 2026-11-18): one person; a
 * copy each for everyone in a target; or one task up for grabs that someone
 * in a target claims. A target is the chapter, a role's holders, a chapter
 * group's members, everyone holding a role in a tier (#5473), or people
 * picked one by one. Alumni are never in one.
 */
export type TaskWhoTarget =
  | { kind: "chapter" }
  | { kind: "role"; id: string }
  | { kind: "group"; id: string }
  | { kind: "tier"; id: string }
  | { kind: "people"; userIds: string[] };

export type TaskWho =
  | { kind: "person"; userId: string }
  | { kind: "each"; target: TaskWhoTarget }
  | { kind: "someone"; target: TaskWhoTarget };

/** The fields `POST /v1/tasks` takes for who a task is for. */
export type TaskWhoTaskFields =
  | { assignee_id: string }
  | { assignee_ids: string[] }
  | {
      audience: TaskAudience;
      audience_role_id?: string;
      audience_group_id?: string;
      audience_tier_id?: string;
    };

/** The fields `POST /v1/open-tasks` takes for who may claim it. */
export interface TaskWhoOpenTaskFields {
  role_id?: string;
  group_id?: string;
  tier_id?: string;
  user_ids?: string[];
}

/**
 * Where a create goes for a {@link TaskWho}, and the who-fields its body
 * carries beside the task's own (title, due, points…).
 */
export type TaskWhoRequest =
  | { endpoint: "/v1/tasks"; fields: TaskWhoTaskFields }
  | { endpoint: "/v1/open-tasks"; fields: TaskWhoOpenTaskFields };

/** Trimmed, blanks dropped, each once, in the order picked. */
function distinctIds(ids: readonly string[]): string[] {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
}

/**
 * A {@link TaskWho} with its people deduplicated, and a list of one person
 * read as that person (a copy each for one, or one task only they could
 * claim, is the same as giving it to them). Null when nobody is picked.
 */
export function normalizeTaskWho(who: TaskWho): TaskWho | null {
  if (who.kind === "person") {
    const userId = who.userId.trim();
    return userId ? { kind: "person", userId } : null;
  }
  if (who.target.kind !== "people") return who;
  const userIds = distinctIds(who.target.userIds);
  const [only] = userIds;
  if (only === undefined) return null;
  if (userIds.length === 1) return { kind: "person", userId: only };
  return { kind: who.kind, target: { kind: "people", userIds } };
}

/**
 * The create to send for a {@link TaskWho}: `POST /v1/tasks` for one person
 * or a copy each, `POST /v1/open-tasks` for one task up for grabs. Spread
 * `fields` into the body beside the task's own fields. Null when nobody is
 * picked.
 */
export function taskWhoRequest(who: TaskWho): TaskWhoRequest | null {
  const picked = normalizeTaskWho(who);
  if (!picked) return null;
  if (picked.kind === "person") {
    return { endpoint: "/v1/tasks", fields: { assignee_id: picked.userId } };
  }
  const { target } = picked;
  if (picked.kind === "each") {
    switch (target.kind) {
      case "chapter":
        return { endpoint: "/v1/tasks", fields: { audience: "everyone" } };
      case "role":
        return {
          endpoint: "/v1/tasks",
          fields: { audience: "everyone", audience_role_id: target.id },
        };
      case "group":
        return {
          endpoint: "/v1/tasks",
          fields: { audience: "everyone", audience_group_id: target.id },
        };
      case "tier":
        return {
          endpoint: "/v1/tasks",
          fields: { audience: "everyone", audience_tier_id: target.id },
        };
      case "people":
        return {
          endpoint: "/v1/tasks",
          fields: { assignee_ids: target.userIds },
        };
    }
  }
  switch (target.kind) {
    case "chapter":
      return { endpoint: "/v1/open-tasks", fields: {} };
    case "role":
      return { endpoint: "/v1/open-tasks", fields: { role_id: target.id } };
    case "group":
      return { endpoint: "/v1/open-tasks", fields: { group_id: target.id } };
    case "tier":
      return { endpoint: "/v1/open-tasks", fields: { tier_id: target.id } };
    case "people":
      return {
        endpoint: "/v1/open-tasks",
        fields: { user_ids: target.userIds },
      };
  }
}

/**
 * A suggested task's who-fields (its payload, and the edits sent before
 * accepting it), every key present so an edit replaces the whole answer.
 */
export interface TaskWhoSuggestionFields {
  assignee_id: string | null;
  assignee_ids: string[] | null;
  audience: TaskSuggestionAudience | null;
  audience_role_id: string | null;
  audience_group_id: string | null;
}

const NO_SUGGESTION_WHO: TaskWhoSuggestionFields = {
  assignee_id: null,
  assignee_ids: null,
  audience: null,
  audience_role_id: null,
  audience_group_id: null,
};

/**
 * A {@link TaskWho} as a suggested task's fields. Accepting it makes what
 * {@link taskWhoRequest} would send. Nobody picked clears them all.
 */
export function taskWhoSuggestionFields(
  who: TaskWho | null,
): TaskWhoSuggestionFields {
  const picked = who ? normalizeTaskWho(who) : null;
  if (!picked) return { ...NO_SUGGESTION_WHO };
  if (picked.kind === "person") {
    return { ...NO_SUGGESTION_WHO, assignee_id: picked.userId };
  }
  const { target } = picked;
  // A suggestion's payload has no tier field yet (#5473), so the suggested
  // tasks' pickers offer no tiers; one that slipped through picks nobody
  // rather than widening to the chapter.
  if (target.kind === "tier") return { ...NO_SUGGESTION_WHO };
  if (picked.kind === "each" && target.kind === "people") {
    return { ...NO_SUGGESTION_WHO, assignee_ids: target.userIds };
  }
  const audience: TaskSuggestionAudience =
    picked.kind === "each" ? TASK_AUDIENCE_EVERYONE : TASK_AUDIENCE_SOMEONE;
  return {
    ...NO_SUGGESTION_WHO,
    audience,
    audience_role_id: target.kind === "role" ? target.id : null,
    audience_group_id: target.kind === "group" ? target.id : null,
    assignee_ids: target.kind === "people" ? target.userIds : null,
  };
}

/**
 * Two answers to Who? that make the same task: the same people in any order,
 * once normalized (a people set of one is that person). Shared by the web
 * card and the phone's form, so a pick sent back unchanged sends no edit.
 */
export function sameTaskWho(a: TaskWho | null, b: TaskWho | null): boolean {
  const key = (who: TaskWho | null) => {
    const picked = who ? normalizeTaskWho(who) : null;
    if (!picked) return "";
    if (picked.kind === "person") return `person:${picked.userId}`;
    const { target } = picked;
    const on =
      target.kind === "people"
        ? [...target.userIds].sort().join(",")
        : target.kind === "chapter"
          ? ""
          : target.id;
    return `${picked.kind}:${target.kind}:${on}`;
  };
  return key(a) === key(b);
}

/** A task up for grabs, as `GET /v1/open-tasks` reads it. */
export interface TaskWhoOpenTaskSource {
  scope: string;
  scope_id?: string | null;
  scope_user_ids?: string[] | null;
}

/** A task, as the task reads carry it. */
export interface TaskWhoTaskSource {
  assignee_id: string;
  group?: { audience: string; target_id?: string | null } | null;
}

/** A suggested task's payload. */
export interface TaskWhoSuggestionSource {
  assignee_id?: string | null;
  assignee_ids?: string[] | null;
  audience?: string | null;
  audience_role_id?: string | null;
  audience_group_id?: string | null;
}

function targetOf(fields: {
  roleId?: string | null;
  groupId?: string | null;
  tierId?: string | null;
  userIds?: string[] | null;
}): TaskWhoTarget {
  if (fields.roleId) return { kind: "role", id: fields.roleId };
  if (fields.groupId) return { kind: "group", id: fields.groupId };
  if (fields.tierId) return { kind: "tier", id: fields.tierId };
  if (fields.userIds && fields.userIds.length > 0) {
    return { kind: "people", userIds: distinctIds(fields.userIds) };
  }
  return { kind: "chapter" };
}

/**
 * Read a task, a task up for grabs or a suggested task back into the
 * {@link TaskWho} a picker shows. A group task's people aren't on its reads
 * (each copy carries only its group's summary), so pass them in
 * `groupUserIds` (the assignees of the group's copies) when the picker needs
 * them. Null when nobody is picked yet (a suggestion with no one named).
 */
export function taskWhoOf(
  source: TaskWhoOpenTaskSource | TaskWhoTaskSource | TaskWhoSuggestionSource,
  options: { groupUserIds?: readonly string[] } = {},
): TaskWho | null {
  if ("scope" in source && typeof source.scope === "string") {
    return normalizeTaskWho({
      kind: "someone",
      target:
        source.scope === "chapter"
          ? { kind: "chapter" }
          : targetOf({
              roleId: source.scope === "role" ? source.scope_id : null,
              groupId: source.scope === "group" ? source.scope_id : null,
              tierId: source.scope === "tier" ? source.scope_id : null,
              userIds: source.scope === "people" ? source.scope_user_ids : [],
            }),
    });
  }
  if ("group" in source && source.group) {
    const { audience, target_id } = source.group;
    const target: TaskWhoTarget =
      audience === "role" && target_id
        ? { kind: "role", id: target_id }
        : audience === "group" && target_id
          ? { kind: "group", id: target_id }
          : audience === "tier" && target_id
            ? { kind: "tier", id: target_id }
            : audience === "people"
              ? { kind: "people", userIds: [...(options.groupUserIds ?? [])] }
              : { kind: "chapter" };
    // A people group read without its people still says "a copy each".
    return target.kind === "people" && target.userIds.length < 2
      ? { kind: "each", target }
      : normalizeTaskWho({ kind: "each", target });
  }
  const fields = source as TaskWhoSuggestionSource;
  if (
    fields.audience === TASK_AUDIENCE_EVERYONE ||
    fields.audience === TASK_AUDIENCE_SOMEONE
  ) {
    return normalizeTaskWho({
      kind: fields.audience === TASK_AUDIENCE_EVERYONE ? "each" : "someone",
      target: targetOf({
        roleId: fields.audience_role_id,
        groupId: fields.audience_group_id,
        userIds: fields.assignee_ids,
      }),
    });
  }
  if (fields.assignee_ids && fields.assignee_ids.length > 0) {
    return normalizeTaskWho({
      kind: "each",
      target: { kind: "people", userIds: fields.assignee_ids },
    });
  }
  return fields.assignee_id
    ? { kind: "person", userId: fields.assignee_id }
    : null;
}

/**
 * Who a group task went to, in words: "Everyone", "Everyone in Recruitment
 * Committee", "6 people". `target_name` is the role's or group's name as the
 * read carries it (its live name, or the one it had once deleted).
 */
export function taskGroupLabel(group: {
  audience: string;
  target_name?: string | null;
  total: number;
}): string {
  if (
    (group.audience === "role" ||
      group.audience === "group" ||
      group.audience === "tier") &&
    group.target_name
  ) {
    return TASK_AUDIENCE_COPY.everyoneIn(group.target_name);
  }
  if (group.audience === "people")
    return TASK_AUDIENCE_COPY.people(group.total);
  return TASK_AUDIENCE_COPY.everyone;
}

/**
 * Who may claim a task up for grabs, in words: "Anyone in the chapter",
 * "Someone in Philanthropy Chair", "One of Sam, Alex and 3 others" (with
 * `names`, the listed people's names), or "One of 5 people" without them.
 */
export function openTaskScopeLabel(
  posting: {
    scope: string;
    scope_name?: string | null;
    scope_user_ids?: string[] | null;
  },
  names?: readonly string[],
): string {
  if (
    (posting.scope === "role" ||
      posting.scope === "group" ||
      posting.scope === "tier") &&
    posting.scope_name
  ) {
    return TASK_AUDIENCE_COPY.someoneIn(posting.scope_name);
  }
  if (posting.scope === "people") {
    return names && names.length > 0
      ? TASK_AUDIENCE_COPY.someoneAmong(names)
      : `One of ${TASK_AUDIENCE_COPY.people(posting.scope_user_ids?.length ?? 0)}`;
  }
  return TASK_AUDIENCE_COPY.anyone;
}
