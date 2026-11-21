import { describe, expect, it } from "vitest";
import {
  TASK_AUDIENCE_COPY,
  taskWhoRequest,
  type TaskWho,
} from "@repo/validation";
import { memberFallbackLabel } from "./display-names";
import {
  buildWhoDirectory,
  chapterTick,
  EVERYONE_IN_CHAPTER,
  initialOpenTiers,
  initialWhoTab,
  OTHER_ROLES_HEADING,
  personName,
  personTicked,
  pickerMode,
  ROLES_HEADING,
  setTick,
  tickChecked,
  TIERS_FOLD_FROM,
  toggleChapter,
  togglePerson,
  toggleSet,
  whoCount,
  whoFromIds,
  whoHint,
  whoLabel,
  whoMatches,
  whoSummary,
  withMode,
} from "./task-who-picker";

/**
 * The Who picker's rules (tasks.md § The Who picker), apart from web's popover
 * and the phone's sheet: who it lists, what a tick does, and the words it
 * says.
 */
const directory = buildWhoDirectory({
  viewerUserId: "u-viewer",
  members: [
    { user_id: "u-sam", display_name: "Sam Lee", role_ids: ["recruit"] },
    { user_id: "u-viewer", display_name: "Paul Carlson", role_ids: ["exec"] },
    { user_id: "u-alex", display_name: "Alex Kim", role_ids: ["recruit"] },
    // Alumni never get a task.
    { user_id: "u-old", display_name: "Old Timer", role_ids: ["recruit"], is_alumni: true },
    { user_id: "u-blank", display_name: "  ", role_ids: [] },
  ],
  roles: [
    { id: "everyone", name: "Everyone", system_key: "EVERYONE", display_order: 0 },
    { id: "alumni", name: "Alumni", system_key: "ALUMNI", display_order: 1 },
    { id: "exec", name: "President", tier_id: "t-exec", display_order: 2 },
    { id: "recruit", name: "Recruitment Committee", tier_id: "t-comm", display_order: 3 },
    { id: "loose", name: "Historian", tier_id: null, display_order: 4 },
    { id: "empty", name: "Scholarship", tier_id: "t-exec", display_order: 5 },
  ],
  tiers: [
    { id: "t-comm", name: "Committees", position: 2 },
    { id: "t-exec", name: "Executive Board", position: 1 },
    { id: "t-none", name: "Chairs", position: 3 },
  ],
  groups: [
    { id: "g-phil", name: "Philanthropy", kind: "manual", member_ids: ["u-sam", "u-old"] },
    { id: "g-empty", name: "Formal planning", kind: "manual", member_ids: [] },
    { id: "g-auto", name: "Class of 2030", kind: "class", member_ids: ["u-old"] },
  ],
});

const RECRUIT = directory.sets.get("recruit")!;
const EMPTY_ROLE = directory.sets.get("empty")!;
const PHIL = directory.sets.get("g-phil")!;
const EMPTY_GROUP = directory.sets.get("g-empty")!;
const CHAPTER: TaskWho = { kind: "each", target: { kind: "chapter" } };
const ROLE: TaskWho = { kind: "each", target: { kind: "role", id: "recruit" } };

describe("buildWhoDirectory", () => {
  it("lists active members only, the viewer first, then by name", () => {
    expect(directory.people.map((person) => person.userId)).toEqual([
      "u-viewer",
      "u-alex",
      "u-blank",
      "u-sam",
    ]);
    expect(directory.byId.get("u-viewer")!.isViewer).toBe(true);
    expect(directory.byId.has("u-old")).toBe(false);
    expect(directory.activeIds).toEqual(directory.people.map((p) => p.userId));
  });

  it("names a member with no name by the shared fallback", () => {
    expect(directory.byId.get("u-blank")).toMatchObject({
      name: memberFallbackLabel("u-blank"),
      named: false,
    });
    expect(directory.byId.get("u-sam")!.named).toBe(true);
    expect(personName("u-gone", directory)).toBe(memberFallbackLabel("u-gone"));
  });

  it("leaves Everyone and Alumni out, and orders the tiers, loose roles last", () => {
    expect(directory.tiers.map((tier) => tier.name)).toEqual([
      "Executive Board",
      "Committees",
      OTHER_ROLES_HEADING,
    ]);
    expect(directory.tiers[0]!.roles.map((role) => role.name)).toEqual([
      "President",
      "Scholarship",
    ]);
    expect(directory.sets.has("everyone")).toBe(false);
    expect(directory.sets.has("alumni")).toBe(false);
  });

  it("calls the roles plain Roles when the chapter has no tiers", () => {
    const flat = buildWhoDirectory({
      viewerUserId: null,
      members: [],
      roles: [{ id: "r", name: "Rush", display_order: 1 }],
      tiers: [],
    });
    expect(flat.tiers.map((tier) => [tier.id, tier.name])).toEqual([
      [null, ROLES_HEADING],
    ]);
  });

  it("keeps only a set's active members, in roster order", () => {
    // An alum holds Recruitment Committee too, and isn't counted.
    expect(RECRUIT.memberIds).toEqual(["u-alex", "u-sam"]);
    expect(PHIL.memberIds).toEqual(["u-sam"]);
    expect(EMPTY_ROLE.memberIds).toEqual([]);
  });

  it("keeps an empty manual group, greyed, and drops an empty automatic one", () => {
    expect(directory.groups.map((group) => group.id)).toEqual([
      "g-phil",
      "g-empty",
    ]);
  });

  it("stands the roster in for the people while members are out", () => {
    const fromRoster = buildWhoDirectory({
      roster: [{ user_id: "u-1", display_name: "Jo" }],
      viewerUserId: null,
    });
    expect(fromRoster.people.map((person) => person.name)).toEqual(["Jo"]);
    expect(fromRoster.tiers).toEqual([]);
  });
});

describe("ticking people", () => {
  it("is one person, then those people, then the chapter once everyone is in", () => {
    let who = togglePerson(null, "u-sam", "each", directory);
    expect(who).toEqual({ kind: "person", userId: "u-sam" });
    who = togglePerson(who, "u-alex", "each", directory);
    expect(who).toEqual({
      kind: "each",
      target: { kind: "people", userIds: ["u-sam", "u-alex"] },
    });
    who = togglePerson(who, "u-viewer", "each", directory);
    who = togglePerson(who, "u-blank", "each", directory);
    expect(who).toEqual(CHAPTER);
  });

  it("drops to nobody when the last one is unticked", () => {
    expect(
      togglePerson({ kind: "person", userId: "u-sam" }, "u-sam", "each", directory),
    ).toBeNull();
    expect(whoFromIds([], "each", directory)).toBeNull();
  });

  it("narrows the chapter to the rest when one member is unticked", () => {
    expect(togglePerson(CHAPTER, "u-viewer", "someone", directory)).toEqual({
      kind: "someone",
      target: { kind: "people", userIds: ["u-alex", "u-blank", "u-sam"] },
    });
  });

  it("narrows a ticked role to the rest of its holders", () => {
    expect(togglePerson(ROLE, "u-alex", "each", directory)).toEqual({
      kind: "person",
      userId: "u-sam",
    });
    const big = buildWhoDirectory({
      viewerUserId: null,
      members: ["a", "b", "c", "d"].map((id) => ({
        user_id: id,
        display_name: id,
        role_ids: id === "d" ? [] : ["r"],
      })),
      roles: [{ id: "r", name: "Rush", display_order: 1 }],
    });
    expect(
      togglePerson({ kind: "someone", target: { kind: "role", id: "r" } }, "b", "someone", big),
    ).toEqual({ kind: "someone", target: { kind: "people", userIds: ["a", "c"] } });
  });
});

describe("ticking a role or group", () => {
  it("makes it the pick from nothing or from some of its own members", () => {
    expect(toggleSet(null, RECRUIT, "each", directory)).toEqual(ROLE);
    expect(
      toggleSet({ kind: "person", userId: "u-sam" }, RECRUIT, "each", directory),
    ).toEqual(ROLE);
  });

  it("switches to it from the whole chapter, narrowing down the tree", () => {
    expect(
      toggleSet({ kind: "someone", target: { kind: "chapter" } }, PHIL, "someone", directory),
    ).toEqual({ kind: "someone", target: { kind: "group", id: "g-phil" } });
    expect(toggleSet(CHAPTER, RECRUIT, "each", directory)).toEqual(ROLE);
  });

  it("adds its members beside someone outside it, and takes them out again", () => {
    const added = toggleSet(
      { kind: "person", userId: "u-viewer" },
      RECRUIT,
      "each",
      directory,
    );
    expect(added).toEqual({
      kind: "each",
      target: { kind: "people", userIds: ["u-viewer", "u-alex", "u-sam"] },
    });
    expect(toggleSet(added, RECRUIT, "each", directory)).toEqual({
      kind: "person",
      userId: "u-viewer",
    });
  });

  it("adds a second set's members to the first's as people", () => {
    const president = directory.sets.get("exec")!;
    expect(toggleSet(ROLE, president, "someone", directory)).toEqual({
      kind: "someone",
      target: { kind: "people", userIds: ["u-alex", "u-sam", "u-viewer"] },
    });
  });

  it("unticks the role that is the pick to nobody", () => {
    expect(toggleSet(ROLE, RECRUIT, "each", directory)).toBeNull();
  });

  it("does nothing for a role or group nobody holds", () => {
    const who: TaskWho = { kind: "person", userId: "u-sam" };
    expect(toggleSet(who, EMPTY_GROUP, "each", directory)).toBe(who);
    expect(toggleSet(CHAPTER, EMPTY_ROLE, "each", directory)).toBe(CHAPTER);
    expect(setTick(who, EMPTY_GROUP, directory)).toBe("none");
  });
});

describe("the chapter", () => {
  it("ticks and unticks the whole chapter", () => {
    const chapter = toggleChapter(null, "each", directory);
    expect(chapter).toEqual(CHAPTER);
    expect(chapterTick(chapter, directory)).toBe("all");
    expect(chapterTick({ kind: "person", userId: "u-sam" }, directory)).toBe("some");
    expect(chapterTick(null, directory)).toBe("none");
    expect(toggleChapter(chapter, "each", directory)).toBeNull();
    expect(toggleChapter(ROLE, "someone", directory)).toEqual({
      kind: "someone",
      target: { kind: "chapter" },
    });
  });
});

describe("ticks", () => {
  it("reads a set's box as all, some or none of it", () => {
    expect(setTick(null, RECRUIT, directory)).toBe("none");
    expect(setTick({ kind: "person", userId: "u-sam" }, RECRUIT, directory)).toBe("some");
    expect(setTick(ROLE, RECRUIT, directory)).toBe("all");
    expect(setTick(ROLE, PHIL, directory)).toBe("all");
    expect(setTick({ kind: "person", userId: "u-viewer" }, PHIL, directory)).toBe("none");
    expect(setTick(CHAPTER, RECRUIT, directory)).toBe("all");
    expect(personTicked(ROLE, "u-alex", directory)).toBe(true);
    expect(personTicked(ROLE, "u-viewer", directory)).toBe(false);
  });

  it("maps a tick to aria-checked", () => {
    expect(tickChecked("all")).toBe(true);
    expect(tickChecked("some")).toBe("mixed");
    expect(tickChecked("none")).toBe(false);
  });
});

describe("the mode", () => {
  it("sets the mode on more than one person, and never on one", () => {
    const person: TaskWho = { kind: "person", userId: "u-sam" };
    expect(withMode(person, "someone")).toBe(person);
    expect(withMode(CHAPTER, "someone")).toEqual({
      kind: "someone",
      target: { kind: "chapter" },
    });
  });

  it("keeps the mode going down to one person and back up", () => {
    let held = pickerMode(
      { kind: "someone", target: { kind: "people", userIds: ["u-sam", "u-alex"] } },
      "each",
    );
    expect(held).toBe("someone");
    let who = togglePerson(
      { kind: "someone", target: { kind: "people", userIds: ["u-sam", "u-alex"] } },
      "u-alex",
      held,
      directory,
    );
    expect(who).toEqual({ kind: "person", userId: "u-sam" });
    held = pickerMode(who, held);
    expect(held).toBe("someone");
    who = togglePerson(who, "u-viewer", held, directory);
    expect(who).toEqual({
      kind: "someone",
      target: { kind: "people", userIds: ["u-sam", "u-viewer"] },
    });
  });

  it("keeps the mode when ticking a role or the chapter", () => {
    // One person shows no mode, but the picker held "someone" from before.
    const sam: TaskWho = { kind: "person", userId: "u-sam" };
    const role = toggleSet(sam, RECRUIT, pickerMode(sam, "someone"), directory);
    expect(role).toEqual({
      kind: "someone",
      target: { kind: "role", id: "recruit" },
    });
    expect(toggleChapter(role, pickerMode(role, "each"), directory)).toEqual({
      kind: "someone",
      target: { kind: "chapter" },
    });
  });

  it("sends the pick to the endpoint it needs", () => {
    expect(
      taskWhoRequest({ kind: "someone", target: { kind: "role", id: "recruit" } }),
    ).toEqual({ endpoint: "/v1/open-tasks", fields: { role_id: "recruit" } });
    expect(
      taskWhoRequest({ kind: "each", target: { kind: "group", id: "g-phil" } }),
    ).toEqual({
      endpoint: "/v1/tasks",
      fields: { audience: "everyone", audience_group_id: "g-phil" },
    });
  });
});

describe("words", () => {
  it("labels the pick", () => {
    expect(whoLabel(null, directory)).toBeNull();
    expect(whoLabel({ kind: "person", userId: "u-sam" }, directory)).toBe("Sam Lee");
    expect(whoLabel(CHAPTER, directory)).toBe(TASK_AUDIENCE_COPY.everyone);
    expect(whoLabel({ kind: "someone", target: { kind: "chapter" } }, directory)).toBe(
      TASK_AUDIENCE_COPY.anyone,
    );
    expect(whoLabel(ROLE, directory)).toBe("Everyone in Recruitment Committee");
    expect(
      whoLabel({ kind: "someone", target: { kind: "role", id: "recruit" } }, directory),
    ).toBe("Someone in Recruitment Committee");
    expect(
      whoLabel({ kind: "someone", target: { kind: "group", id: "g-phil" } }, directory),
    ).toBe(TASK_AUDIENCE_COPY.someoneIn("Philanthropy"));
    expect(
      whoLabel({ kind: "each", target: { kind: "people", userIds: ["u-sam", "u-alex"] } }, directory),
    ).toBe(TASK_AUDIENCE_COPY.peopleNames(["Sam", "Alex"]));
  });

  it("sums up who is in, narrowed picks included", () => {
    expect(whoSummary(CHAPTER, directory)).toBe(`${EVERYONE_IN_CHAPTER} · 4`);
    expect(whoSummary(ROLE, directory)).toBe("Recruitment Committee · 2 members");
    const two: TaskWho = {
      kind: "each",
      target: { kind: "people", userIds: ["u-alex", "u-sam"] },
    };
    expect(whoSummary(two, directory, RECRUIT)).toBe("2 of Recruitment Committee");
    expect(whoSummary(two, directory, PHIL)).not.toMatch(/ of /);
    expect(whoSummary({ kind: "person", userId: "u-sam" }, directory)).toBeNull();
    expect(whoCount(ROLE, directory)).toBe(2);
  });

  it("hints each copy, or Up for grabs", () => {
    expect(whoHint(ROLE, directory)).toBe(TASK_AUDIENCE_COPY.eachHint(2));
    expect(whoHint(CHAPTER, directory)).toBe(TASK_AUDIENCE_COPY.everyoneHint(4));
    expect(whoHint({ ...ROLE, kind: "someone" }, directory)).toBe(
      TASK_AUDIENCE_COPY.someoneHint(2),
    );
    expect(whoHint({ kind: "person", userId: "u-sam" }, directory)).toBeNull();
  });

  it("matches a search on the start of any word", () => {
    expect(whoMatches("Recruitment Committee", "comm")).toBe(true);
    expect(whoMatches("Recruitment Committee", "rec com")).toBe(true);
    expect(whoMatches("Recruitment Committee", "mittee")).toBe(false);
    expect(whoMatches("Anything", "  ")).toBe(true);
  });
});

describe("where the picker opens", () => {
  it("opens on Roles and groups for a role or group pick", () => {
    expect(initialWhoTab(ROLE)).toBe("sets");
    expect(initialWhoTab(CHAPTER)).toBe("people");
    expect(initialWhoTab({ kind: "person", userId: "u-sam" })).toBe("people");
    expect(initialWhoTab(null)).toBe("people");
  });

  it("opens every tier in a chapter with few roles", () => {
    expect([...initialOpenTiers(null, directory)]).toEqual([
      "t-exec",
      "t-comm",
      "other",
    ]);
  });

  it("starts a chapter with many roles folded, but the tier holding the pick", () => {
    const many = buildWhoDirectory({
      members: [{ user_id: "a", display_name: "A", role_ids: ["r-1"] }],
      roles: Array.from({ length: TIERS_FOLD_FROM + 1 }, (_, index) => ({
        id: `r-${index}`,
        name: `Role ${index}`,
        tier_id: index === 0 ? "t-a" : "t-b",
      })),
      tiers: [
        { id: "t-a", name: "A", position: 0 },
        { id: "t-b", name: "B", position: 1 },
      ],
      viewerUserId: null,
    });
    expect([...initialOpenTiers(null, many)]).toEqual([]);
    expect([...initialOpenTiers(CHAPTER, many)]).toEqual([]);
    expect([
      ...initialOpenTiers({ kind: "each", target: { kind: "role", id: "r-0" } }, many),
    ]).toEqual(["t-a"]);
  });
});

describe("a tier as a pick (#5473)", () => {
  const EXEC = directory.sets.get("t-exec")!;
  const TIER: TaskWho = { kind: "each", target: { kind: "tier", id: "t-exec" } };

  it("makes each tier with roles a set of everyone holding one of them", () => {
    expect(EXEC).toMatchObject({ kind: "tier", name: "Executive Board" });
    expect(EXEC.memberIds).toEqual(["u-viewer"]);
    expect(directory.sets.get("t-comm")?.memberIds).toEqual(["u-alex", "u-sam"]);
    // The roles in no tier have no set of their own.
    expect(directory.tiers.at(-1)?.set).toBeNull();
  });

  it("reaches the chapter when the tier holds the Everyone role", () => {
    const withEveryone = buildWhoDirectory({
      viewerUserId: "u-a",
      members: [
        { user_id: "u-a", display_name: "A", role_ids: ["officer"] },
        { user_id: "u-b", display_name: "B", role_ids: [] },
      ],
      roles: [
        { id: "everyone", name: "Member", system_key: "EVERYONE", tier_id: "t-all", display_order: 0 },
        { id: "officer", name: "Officer", tier_id: "t-all", display_order: 1 },
      ],
      tiers: [{ id: "t-all", name: "Members", position: 1 }],
    });
    expect(withEveryone.sets.get("t-all")?.memberIds.sort()).toEqual(["u-a", "u-b"]);
    // Which the API refuses as what a task is from.
    expect(withEveryone.tiers[0]?.holdsEveryone).toBe(true);
    expect(directory.tiers.every((tier) => !tier.holdsEveryone)).toBe(true);
  });

  it("ticks, labels, sends and opens a tier pick like a role's", () => {
    expect(toggleSet(null, EXEC, "each", directory)).toEqual(TIER);
    expect(toggleSet(TIER, EXEC, "each", directory)).toBeNull();
    expect(whoLabel(TIER, directory)).toBe("Everyone in Executive Board");
    expect(whoSummary(TIER, directory)).toBe("Executive Board · 1 member");
    expect(taskWhoRequest(TIER)).toEqual({
      endpoint: "/v1/tasks",
      fields: { audience: "everyone", audience_tier_id: "t-exec" },
    });
    expect(initialWhoTab(TIER)).toBe("sets");
    expect(initialOpenTiers(TIER, directory).has("t-exec")).toBe(true);
  });
});
