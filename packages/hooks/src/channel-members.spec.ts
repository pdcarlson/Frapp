import { describe, expect, it } from "vitest";
import { compareChannelMembers } from "./channel-members";

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
