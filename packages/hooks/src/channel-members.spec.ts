import { describe, expect, it } from "vitest";
import {
  NO_ROLE_GROUP_LABEL,
  compareChannelMembers,
  filterChannelMembers,
  groupChannelMembersByRole,
} from "./channel-members";

describe("compareChannelMembers", () => {
  it("sorts by role rank, a member with no role last, then by name", () => {
    const sorted = [
      { id: "none", name: "Aaron", roleRank: null },
      { id: "member", name: "Zoe", roleRank: 5 },
      { id: "member2", name: "bea", roleRank: 5 },
      { id: "pres", name: "Yves", roleRank: 0 },
    ].sort(compareChannelMembers);
    expect(sorted.map((row) => row.id)).toEqual([
      "pres",
      "member2",
      "member",
      "none",
    ]);
  });
});

describe("groupChannelMembersByRole", () => {
  const row = (
    id: string,
    name: string,
    roleRank: number | null,
    roleId: string | null,
    roleName: string | null,
  ) => ({ id, name, roleRank, roleId, roleName });

  it("groups by highest role in role order, names A to Z, no role last", () => {
    const groups = groupChannelMembersByRole([
      row("a", "Zoe", 5, "member", "Member"),
      row("b", "aaron", 5, "member", "Member"),
      row("c", "Yves", 1, "pres", "President"),
      row("d", "Bob", null, null, null),
      row("e", "Cal", 2, "treas", "Treasurer"),
    ]);
    expect(groups.map((g) => [g.label, g.rows.map((r) => r.id)])).toEqual([
      ["President", ["c"]],
      ["Treasurer", ["e"]],
      ["Member", ["b", "a"]],
      [NO_ROLE_GROUP_LABEL, ["d"]],
    ]);
  });

  it("keeps two same-named roles apart by id", () => {
    const groups = groupChannelMembersByRole([
      row("a", "A", 8, "r1", "Chair"),
      row("b", "B", 9, "r2", "Chair"),
    ]);
    expect(groups.map((g) => g.key)).toEqual(["r1", "r2"]);
  });

  it("falls back to one list when the API sends no role ids", () => {
    const groups = groupChannelMembersByRole([
      { id: "a", name: "Zed", roleRank: 5 } as never,
      { id: "b", name: "Al", roleRank: 1 } as never,
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.label).toBe("Members");
  });

  it("returns nothing for no rows", () => {
    expect(groupChannelMembersByRole([])).toEqual([]);
  });
});

describe("filterChannelMembers", () => {
  const rows = [
    { name: "Jake Smith" },
    { name: "José Álvarez" },
    { name: "Mary-Kate O'Neil" },
  ];
  const names = (query: string) =>
    filterChannelMembers(rows, query).map((r) => r.name);

  it("matches word starts, any order, ignoring case and accents", () => {
    expect(names("sm ja")).toEqual(["Jake Smith"]);
    expect(names("jose")).toEqual(["José Álvarez"]);
    expect(names("kate")).toEqual(["Mary-Kate O'Neil"]);
    expect(names("neil")).toEqual(["Mary-Kate O'Neil"]);
  });

  it("does not match the middle of a word", () => {
    expect(names("ith")).toEqual([]);
  });

  it("keeps everyone for a blank query", () => {
    expect(names("  ")).toHaveLength(3);
  });
});
