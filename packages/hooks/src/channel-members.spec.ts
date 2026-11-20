import { describe, expect, it } from "vitest";
import {
  OUTSIDE_TIERS_GROUP_KEY,
  channelMemberTitle,
  compareChannelMembers,
  filterChannelMembers,
  groupChannelMembersByTier,
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

describe("groupChannelMembersByTier", () => {
  const row = (
    id: string,
    name: string,
    roleRank: number | null,
    tierId: string | null,
    tierName: string | null,
    tierRank: number | null,
    title: string | null = null,
  ) => ({ id, name, roleRank, tierId, tierName, tierRank, title });

  it("runs tier by tier, by title inside each, everyone outside the tiers last", () => {
    // Paul, 2026-11-20: Cabinet first with the President leading, then the
    // chairs, then the brothers; an untiered "First Floor" never heads it.
    const groups = groupChannelMembersByTier([
      row(
        "gabe",
        "Gabe",
        3,
        "chairs",
        "Committee Chairs",
        2,
        "Recruitment Chair",
      ),
      row("zoe", "Zoe", 9, "brothers", "Brothers", 4),
      row("aaron", "aaron", 9, "brothers", "Brothers", 4),
      row("paul", "Paul", 0, "cabinet", "Cabinet", 1, "President"),
      row("bob", "Bob", null, null, null, null),
      row("cal", "Cal", 1, "cabinet", "Cabinet", 1, "Treasurer"),
      row("floor", "Fred", 12, null, null, null, "First Floor"),
    ]);
    expect(groups.map((g) => [g.label, g.rows.map((r) => r.id)])).toEqual([
      ["Cabinet", ["paul", "cal"]],
      ["Committee Chairs", ["gabe"]],
      ["Brothers", ["aaron", "zoe"]],
      ["Members", ["floor", "bob"]],
    ]);
    expect(groups.at(-1)!.key).toBe(OUTSIDE_TIERS_GROUP_KEY);
  });

  it("heads the outside group apart when a tier is already called Members", () => {
    const groups = groupChannelMembersByTier([
      row("a", "Al", 5, "t-mem", "Members", 3),
      row("b", "Bo", 9, null, null, null, "Alumni"),
    ]);
    expect(groups.map((g) => g.label)).toEqual(["Members", "Everyone else"]);
  });

  it("falls back to one ranked list when the API sends no tiers", () => {
    const groups = groupChannelMembersByTier([
      { id: "a", name: "Zed", roleRank: 5 } as never,
      { id: "b", name: "Al", roleRank: 1 } as never,
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.label).toBe("Members");
    expect(groups[0]!.rows.map((r: { id: string }) => r.id)).toEqual([
      "b",
      "a",
    ]);
  });

  it("returns nothing for no rows", () => {
    expect(groupChannelMembersByTier([])).toEqual([]);
  });
});

describe("channelMemberTitle", () => {
  it("shows the title unless it only repeats the heading", () => {
    expect(channelMemberTitle({ title: "President" }, "Cabinet")).toBe(
      "President",
    );
    expect(
      channelMemberTitle({ title: "Frapp Development" }, "Frapp development"),
    ).toBeNull();
    expect(
      channelMemberTitle({ title: "New Member" }, "New members"),
    ).toBeNull();
    expect(channelMemberTitle({ title: null }, "Brothers")).toBeNull();
    expect(channelMemberTitle({ title: "  " }, "Brothers")).toBeNull();
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
    expect(names("mary-kate o'neil")).toEqual(["Mary-Kate O'Neil"]);
  });

  it("does not match the middle of a word", () => {
    expect(names("ith")).toEqual([]);
  });

  it("keeps everyone for a blank query", () => {
    expect(names("  ")).toHaveLength(3);
  });
});
