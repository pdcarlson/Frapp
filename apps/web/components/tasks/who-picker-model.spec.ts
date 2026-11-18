import { describe, expect, it } from "vitest";
import { taskWhoRequest, type TaskWho } from "@repo/validation";
import {
  buildWhoDirectory,
  includedIds,
  matchesSearch,
  openSections,
  setTick,
  toggleChapter,
  togglePerson,
  toggleSet,
  whoFromIds,
  whoHint,
  whoLabel,
  whoSummary,
  withMode,
} from "./who-picker-model";

const directory = buildWhoDirectory({
  viewerId: "u-paul",
  members: [
    { user_id: "u-sam", display_name: "Sam Ortiz", role_ids: ["role-rush"] },
    { user_id: "u-paul", display_name: "Paul Carlson", role_ids: ["role-pres"] },
    { user_id: "u-alex", display_name: "Alex Kim", role_ids: ["role-rush"] },
    { user_id: "u-jo", display_name: "Jo Park", role_ids: [] },
    // Alumni never get a task.
    { user_id: "u-old", display_name: "Old Timer", role_ids: ["role-rush"], is_alumni: true },
  ],
  roles: [
    { id: "role-member", name: "Member", system_key: "MEMBER", display_order: 99 },
    { id: "role-alumni", name: "Alumni", system_key: "ALUMNI", display_order: 98 },
    { id: "role-pres", name: "President", tier_id: "tier-exec", display_order: 1 },
    { id: "role-rush", name: "Recruitment Committee", display_order: 2 },
    { id: "role-empty", name: "Historian", tier_id: "tier-exec", display_order: 3 },
  ],
  tiers: [
    { id: "tier-exec", name: "Exec board", position: 1 },
    { id: "tier-none-held", name: "Chairs", position: 2 },
  ],
  groups: [{ id: "group-ride", name: "Ride crew", member_ids: ["u-jo", "u-sam", "u-old"] }],
});

const rush = directory.sets.get("role-rush")!;
const ride = directory.sets.get("group-ride")!;

describe("buildWhoDirectory", () => {
  it("lists active members, the viewer first, then by name", () => {
    expect(directory.people.map((person) => person.name)).toEqual([
      "Paul Carlson",
      "Alex Kim",
      "Jo Park",
      "Sam Ortiz",
    ]);
    expect(directory.byId.get("u-paul")!.isViewer).toBe(true);
    expect(directory.byId.has("u-old")).toBe(false);
  });

  it("leaves out the Everyone and Alumni roles, and tiers with no roles", () => {
    expect([...directory.sets.keys()]).not.toContain("role-member");
    expect([...directory.sets.keys()]).not.toContain("role-alumni");
    expect(directory.tiers.map((tier) => tier.name)).toEqual(["Exec board"]);
    expect(directory.tiers[0]!.roles.map((role) => role.name)).toEqual([
      "President",
      "Historian",
    ]);
    expect(directory.untiered.map((role) => role.name)).toEqual([
      "Recruitment Committee",
    ]);
  });

  it("keeps only a set's active members, in roster order", () => {
    expect(rush.memberIds).toEqual(["u-alex", "u-sam"]);
    expect(ride.memberIds).toEqual(["u-jo", "u-sam"]);
    expect(directory.sets.get("role-empty")!.memberIds).toEqual([]);
  });
});

describe("picking", () => {
  it("is one person, then those people, then the chapter once everyone is in", () => {
    let who: TaskWho | null = togglePerson(null, "u-sam", directory);
    expect(who).toEqual({ kind: "person", userId: "u-sam" });
    who = togglePerson(who, "u-jo", directory);
    expect(who).toEqual({
      kind: "each",
      target: { kind: "people", userIds: ["u-sam", "u-jo"] },
    });
    who = togglePerson(who, "u-paul", directory);
    who = togglePerson(who, "u-alex", directory);
    expect(who).toEqual({ kind: "each", target: { kind: "chapter" } });
    // Unticking one from the chapter leaves the rest, named.
    who = togglePerson(who, "u-paul", directory);
    expect(includedIds(who, directory)).toEqual(["u-alex", "u-jo", "u-sam"]);
  });

  it("drops to nobody when the last one is unticked", () => {
    expect(togglePerson({ kind: "person", userId: "u-sam" }, "u-sam", directory)).toBeNull();
    expect(whoFromIds([], "each", directory)).toBeNull();
  });

  it("ticks a role or group whole and unticks it again, keeping the mode", () => {
    const someone = withMode(
      { kind: "each", target: { kind: "people", userIds: ["u-sam", "u-jo"] } },
      "someone",
    );
    const role = toggleSet(someone, rush);
    expect(role).toEqual({ kind: "someone", target: { kind: "role", id: "role-rush" } });
    expect(toggleSet(role, rush)).toBeNull();
    expect(toggleChapter(null)).toEqual({ kind: "each", target: { kind: "chapter" } });
    expect(toggleChapter({ kind: "each", target: { kind: "chapter" } })).toBeNull();
  });

  it("never gives one person a mode", () => {
    const one: TaskWho = { kind: "person", userId: "u-sam" };
    expect(withMode(one, "someone")).toBe(one);
  });

  it("reads a set's box as all, some or none of it", () => {
    const role: TaskWho = { kind: "each", target: { kind: "role", id: "role-rush" } };
    expect(setTick(role, rush, directory)).toBe(true);
    expect(setTick(role, ride, directory)).toBe("mixed");
    expect(setTick({ kind: "person", userId: "u-paul" }, ride, directory)).toBe(false);
    expect(
      setTick({ kind: "each", target: { kind: "chapter" } }, ride, directory),
    ).toBe(true);
  });

  it("sends the pick to the endpoint it needs", () => {
    expect(
      taskWhoRequest({ kind: "someone", target: { kind: "role", id: "role-rush" } }),
    ).toEqual({ endpoint: "/v1/open-tasks", fields: { role_id: "role-rush" } });
    expect(
      taskWhoRequest({ kind: "each", target: { kind: "group", id: "group-ride" } }),
    ).toEqual({
      endpoint: "/v1/tasks",
      fields: { audience: "everyone", audience_group_id: "group-ride" },
    });
  });
});

describe("words", () => {
  it("names the pick on the trigger", () => {
    expect(whoLabel({ kind: "person", userId: "u-sam" }, directory)).toBe("Sam Ortiz");
    expect(whoLabel({ kind: "each", target: { kind: "chapter" } }, directory)).toBe(
      "Everyone",
    );
    expect(whoLabel({ kind: "someone", target: { kind: "chapter" } }, directory)).toBe(
      "Anyone in the chapter",
    );
    expect(
      whoLabel({ kind: "each", target: { kind: "role", id: "role-rush" } }, directory),
    ).toBe("Everyone in Recruitment Committee");
    expect(
      whoLabel({ kind: "someone", target: { kind: "role", id: "role-rush" } }, directory),
    ).toBe("Someone in Recruitment Committee");
  });

  it("sums it up in the footer, narrowed picks included", () => {
    expect(whoSummary({ kind: "each", target: { kind: "chapter" } }, directory)).toBe(
      "Everyone in the chapter · 4",
    );
    expect(
      whoSummary({ kind: "each", target: { kind: "role", id: "role-rush" } }, directory),
    ).toBe("Recruitment Committee · 2 members");
    const two: TaskWho = {
      kind: "each",
      target: { kind: "people", userIds: ["u-jo", "u-sam"] },
    };
    expect(whoSummary(two, directory, ride)).toBe("2 of Ride crew");
    expect(whoSummary(two, directory, rush)).not.toMatch(/ of /);
    expect(whoSummary({ kind: "person", userId: "u-jo" }, directory)).toBeNull();
  });

  it("hints who gets what, by mode", () => {
    const each = whoHint({ kind: "each", target: { kind: "role", id: "role-rush" } }, directory);
    const someone = whoHint(
      { kind: "someone", target: { kind: "role", id: "role-rush" } },
      directory,
    );
    expect(each).toBeTruthy();
    expect(someone).toBeTruthy();
    expect(each).not.toBe(someone);
    expect(whoHint({ kind: "person", userId: "u-jo" }, directory)).toBeNull();
  });

  it("matches a search on the start of any word", () => {
    expect(matchesSearch("Recruitment Committee", "comm")).toBe(true);
    expect(matchesSearch("Recruitment Committee", "rec com")).toBe(true);
    expect(matchesSearch("Recruitment Committee", "mittee")).toBe(false);
    expect(matchesSearch("Anything", "  ")).toBe(true);
  });
});

describe("openSections", () => {
  it("opens only the tier, Other roles or Groups holding the pick", () => {
    expect(openSections(null, directory)).toEqual(new Set());
    expect(
      openSections({ kind: "each", target: { kind: "role", id: "role-pres" } }, directory),
    ).toEqual(new Set(["tier:tier-exec"]));
    expect(
      openSections({ kind: "each", target: { kind: "group", id: "group-ride" } }, directory),
    ).toEqual(new Set(["tier:none", "groups"]));
  });

  it("opens the roles when there are no tiers to fold them under", () => {
    const flat = buildWhoDirectory({
      viewerId: null,
      members: [],
      roles: [{ id: "role-rush", name: "Rush", display_order: 1 }],
      tiers: [],
      groups: [],
    });
    expect(openSections(null, flat)).toEqual(new Set(["tier:none"]));
  });
});
