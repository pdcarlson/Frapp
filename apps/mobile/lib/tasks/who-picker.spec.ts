import { describe, expect, it } from "vitest";
import { TASK_AUDIENCE_COPY, type TaskWho } from "@repo/validation";
import {
  buildWhoDirectory,
  chapterTick,
  EVERYONE_IN_CHAPTER,
  GROUPS_HEADING,
  initialOpenTiers,
  OTHER_ROLES_HEADING,
  setTick,
  TIERS_FOLD_FROM,
  toggleChapter,
  togglePerson,
  toggleSet,
  WHO_PICKER_COPY,
  whoCount,
  whoHint,
  whoLabel,
  whoOfLegacyAssignee,
  whoRows,
  whoSummary,
  withMode,
  type WhoRow,
} from "./who-picker";

/**
 * The Assign to picker's rules (the Tasks overhaul § 2), apart from its
 * sheet: who it lists, what a tick does, and the words it says.
 */
const directory = buildWhoDirectory({
  members: [
    { user_id: "u-viewer", display_name: "Paul Carlson", role_ids: ["exec"] },
    { user_id: "u-sam", display_name: "Sam Lee", role_ids: ["recruit"] },
    { user_id: "u-alex", display_name: "Alex Kim", role_ids: ["recruit"] },
    { user_id: "u-old", display_name: "Old Timer", role_ids: ["recruit"], is_alumni: true },
    { user_id: "u-blank", display_name: "  ", role_ids: [] },
  ],
  roles: [
    { id: "everyone", name: "Member", system_key: "MEMBER", display_order: 0 },
    { id: "alumni", name: "Alumni", system_key: "ALUMNI", display_order: 1 },
    { id: "exec", name: "President", tier_id: "t-exec", display_order: 2 },
    { id: "recruit", name: "Recruitment Committee", tier_id: "t-comm", display_order: 3 },
    { id: "loose", name: "Historian", tier_id: null, display_order: 4 },
  ],
  tiers: [
    { id: "t-comm", name: "Committees", position: 2 },
    { id: "t-exec", name: "Executive Board", position: 1 },
  ],
  groups: [
    { id: "g-phil", name: "Philanthropy", kind: "manual", member_ids: ["u-sam", "u-old"] },
    { id: "g-empty", name: "Formal planning", kind: "manual", member_ids: [] },
    { id: "g-auto", name: "Class of 2030", kind: "class", member_ids: ["u-old"] },
  ],
  viewerUserId: "u-viewer",
  fallbackName: (id) => `Member ${id.slice(-4)}`,
});

const RECRUIT = directory.tiers[1]!.roles[0]!;
const PHIL = directory.groups[0]!;

describe("buildWhoDirectory", () => {
  it("lists active members only, the viewer first, then by name", () => {
    expect(directory.people.map((person) => person.userId)).toEqual([
      "u-viewer",
      "u-alex",
      "u-blank",
      "u-sam",
    ]);
    expect(directory.people[0]!.isViewer).toBe(true);
    const blank = directory.people.find((person) => person.userId === "u-blank")!;
    expect(blank).toMatchObject({ name: "Member lank", named: false });
  });

  it("leaves Everyone and Alumni out, and orders the tiers, loose roles last", () => {
    expect(directory.tiers.map((tier) => tier.name)).toEqual([
      "Executive Board",
      "Committees",
      OTHER_ROLES_HEADING,
    ]);
    // An alum holds Recruitment Committee too, and isn't counted.
    expect(RECRUIT.memberIds).toEqual(["u-alex", "u-sam"]);
  });

  it("keeps an empty manual group, greyed, and drops an empty automatic one", () => {
    expect(directory.groups.map((group) => group.id)).toEqual([
      "g-phil",
      "g-empty",
    ]);
    expect(PHIL.memberIds).toEqual(["u-sam"]);
  });

  it("stands the roster in for the people while members are out", () => {
    const fromRoster = buildWhoDirectory({
      roster: [{ user_id: "u-1", display_name: "Jo" }],
      viewerUserId: null,
      fallbackName: (id) => id,
    });
    expect(fromRoster.people.map((person) => person.name)).toEqual(["Jo"]);
    expect(fromRoster.tiers).toEqual([]);
  });
});

describe("ticks", () => {
  const each = "each" as const;

  it("ticks people into a list, and one person is a person", () => {
    let who = togglePerson(null, "u-sam", each, directory);
    expect(who).toEqual({ kind: "person", userId: "u-sam" });
    who = togglePerson(who, "u-alex", each, directory);
    expect(who).toEqual({
      kind: "each",
      target: { kind: "people", userIds: ["u-sam", "u-alex"] },
    });
    expect(togglePerson(togglePerson(who, "u-alex", each, directory), "u-sam", each, directory)).toBeNull();
  });

  it("reads a role as all, some or none of its holders", () => {
    expect(setTick(RECRUIT, null, directory)).toBe("none");
    expect(setTick(RECRUIT, { kind: "person", userId: "u-sam" }, directory)).toBe("some");
    const role: TaskWho = { kind: "each", target: { kind: "role", id: "recruit" } };
    expect(setTick(RECRUIT, role, directory)).toBe("all");
    expect(setTick(RECRUIT, { kind: "each", target: { kind: "chapter" } }, directory)).toBe("all");
  });

  it("makes a role the answer from nothing or from some of its own members", () => {
    const role = { kind: "each", target: { kind: "role", id: "recruit" } };
    expect(toggleSet(null, RECRUIT, "each", directory)).toEqual(role);
    expect(
      toggleSet({ kind: "person", userId: "u-sam" }, RECRUIT, "each", directory),
    ).toEqual(role);
  });

  it("unticks a group out of the whole chapter: everyone but them", () => {
    expect(
      toggleSet({ kind: "someone", target: { kind: "chapter" } }, PHIL, "someone", directory),
    ).toEqual({
      kind: "someone",
      target: { kind: "people", userIds: ["u-viewer", "u-alex", "u-blank"] },
    });
  });

  it("adds a role's holders beside someone outside it, and takes them out again", () => {
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

  it("unticks a role that is the answer to nobody", () => {
    expect(
      toggleSet({ kind: "each", target: { kind: "role", id: "recruit" } }, RECRUIT, "each", directory),
    ).toBeNull();
  });

  it("does nothing for a role or group nobody holds", () => {
    const empty = directory.groups[1]!;
    const who: TaskWho = { kind: "person", userId: "u-sam" };
    expect(toggleSet(who, empty, "each", directory)).toBe(who);
    expect(setTick(empty, who, directory)).toBe("none");
  });

  it("ticks and unticks the whole chapter", () => {
    const chapter = toggleChapter(null, "each", directory);
    expect(chapter).toEqual({ kind: "each", target: { kind: "chapter" } });
    expect(chapterTick(chapter, directory)).toBe("all");
    expect(chapterTick({ kind: "person", userId: "u-sam" }, directory)).toBe("some");
    expect(toggleChapter(chapter, "each", directory)).toBeNull();
  });

  it("sets the mode on more than one person, and never on one", () => {
    const person: TaskWho = { kind: "person", userId: "u-sam" };
    expect(withMode(person, "someone")).toBe(person);
    expect(withMode({ kind: "each", target: { kind: "chapter" } }, "someone")).toEqual({
      kind: "someone",
      target: { kind: "chapter" },
    });
  });
});

describe("words", () => {
  const role: TaskWho = { kind: "each", target: { kind: "role", id: "recruit" } };

  it("labels the form's row", () => {
    expect(whoLabel(null, directory)).toBeNull();
    expect(whoLabel({ kind: "person", userId: "u-sam" }, directory)).toBe("Sam Lee");
    expect(whoLabel({ kind: "each", target: { kind: "chapter" } }, directory)).toBe(
      TASK_AUDIENCE_COPY.everyone,
    );
    expect(whoLabel({ kind: "someone", target: { kind: "chapter" } }, directory)).toBe(
      TASK_AUDIENCE_COPY.anyone,
    );
    expect(whoLabel(role, directory)).toBe(
      TASK_AUDIENCE_COPY.everyoneIn("Recruitment Committee"),
    );
    expect(
      whoLabel({ kind: "someone", target: { kind: "group", id: "g-phil" } }, directory),
    ).toBe(TASK_AUDIENCE_COPY.someoneIn("Philanthropy"));
    expect(
      whoLabel({ kind: "each", target: { kind: "people", userIds: ["u-sam", "u-alex"] } }, directory),
    ).toBe(TASK_AUDIENCE_COPY.peopleNames(["Sam", "Alex"]));
  });

  it("sums up who is in, with a count", () => {
    expect(whoSummary({ kind: "each", target: { kind: "chapter" } }, directory)).toBe(
      `${EVERYONE_IN_CHAPTER} · 4`,
    );
    expect(whoSummary(role, directory)).toBe("Recruitment Committee · 2 members");
    expect(whoSummary({ kind: "person", userId: "u-sam" }, directory)).toBeNull();
    expect(whoCount(role, directory)).toBe(2);
  });

  it("hints each copy, or Up for grabs", () => {
    expect(whoHint(role, directory)).toBe(TASK_AUDIENCE_COPY.eachHint(2));
    expect(whoHint({ kind: "each", target: { kind: "chapter" } }, directory)).toBe(
      TASK_AUDIENCE_COPY.everyoneHint(4),
    );
    expect(whoHint({ ...role, kind: "someone" }, directory)).toBe(
      TASK_AUDIENCE_COPY.someoneHint(2),
    );
  });

  it("reads a kept draft's old assignee", () => {
    expect(whoOfLegacyAssignee(null)).toBeNull();
    expect(whoOfLegacyAssignee("everyone")).toEqual({
      kind: "each",
      target: { kind: "chapter" },
    });
    expect(whoOfLegacyAssignee("u-sam")).toEqual({ kind: "person", userId: "u-sam" });
  });
});

describe("whoRows", () => {
  const base = {
    search: "",
    single: false,
    expanded: new Set<string>(),
    openTiers: initialOpenTiers(null, directory),
  };
  const labels = (rows: WhoRow[]) =>
    rows.map((row) =>
      row.kind === "heading"
        ? `# ${row.label}`
        : row.kind === "person"
          ? `${row.nested ? "  " : ""}${row.person.name}`
          : row.kind === "set"
            ? row.set.name
            : "Everyone",
    );

  it("draws Everyone over the people", () => {
    expect(labels(whoRows(directory, { ...base, tab: "people" }))).toEqual([
      "Everyone",
      "Paul Carlson",
      "Alex Kim",
      "Member lank",
      "Sam Lee",
    ]);
  });

  it("draws roles under their tiers, then the groups", () => {
    expect(labels(whoRows(directory, { ...base, tab: "sets" }))).toEqual([
      "Everyone",
      "# Executive Board",
      "President",
      "# Committees",
      "Recruitment Committee",
      `# ${OTHER_ROLES_HEADING}`,
      "Historian",
      `# ${GROUPS_HEADING}`,
      "Philanthropy",
      "Formal planning",
    ]);
  });

  it("opens a role onto its holders, and folds a tier", () => {
    const rows = whoRows(directory, {
      ...base,
      tab: "sets",
      expanded: new Set(["role:recruit"]),
      openTiers: new Set(["t-comm"]),
    });
    expect(labels(rows).slice(0, 6)).toEqual([
      "Everyone",
      "# Executive Board",
      "# Committees",
      "Recruitment Committee",
      "  Alex Kim",
      "  Sam Lee",
    ]);
  });

  it("searches people, roles and groups together", () => {
    expect(
      labels(whoRows(directory, { ...base, tab: "people", search: "p" })),
    ).toEqual([
      `# ${WHO_PICKER_COPY.people}`,
      "Paul Carlson",
      `# ${WHO_PICKER_COPY.rolesAndGroups}`,
      "President",
      "Philanthropy",
      "Formal planning",
    ]);
    expect(
      labels(whoRows(directory, { ...base, tab: "sets", search: "sam" })),
    ).toEqual([`# ${WHO_PICKER_COPY.people}`, "Sam Lee"]);
  });

  it("lists only people, with no Everyone, for one person", () => {
    expect(
      labels(whoRows(directory, { ...base, tab: "sets", single: true })),
    ).toEqual(["Paul Carlson", "Alex Kim", "Member lank", "Sam Lee"]);
  });

  it("starts a chapter with many roles folded, but the tier in use", () => {
    const many = buildWhoDirectory({
      members: [],
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
      fallbackName: (id) => id,
    });
    expect([...initialOpenTiers(null, many)]).toEqual([]);
    expect([
      ...initialOpenTiers({ kind: "each", target: { kind: "role", id: "r-0" } }, many),
    ]).toEqual(["t-a"]);
  });
});
