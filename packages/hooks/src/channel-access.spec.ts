import { describe, expect, it } from "vitest";
import {
  channelAccessReach,
  compareChannelAccessKinds,
  describeChannelAccess,
  isEmptyChannelAccessChoice,
  matchesCategoryAccess,
  selectChannelAccessOptions,
} from "./channel-access";

const options = selectChannelAccessOptions([
  {
    entry: "tier:t1",
    kind: "tier",
    id: "t1",
    name: "Executive",
    color: null,
    tier_id: null,
    user_ids: ["u1", "u2"],
  },
  {
    entry: "role:r1",
    kind: "role",
    id: "r1",
    name: "Brothers",
    color: "#aa0000",
    tier_id: "t2",
    user_ids: ["u2", "u3"],
  },
  { entry: "role:r2", kind: "role", id: "r2", name: "Everyone", hidden: true },
  { entry: 4, kind: "role", id: "bad", name: "Dropped" },
]);

describe("selectChannelAccessOptions (#3702)", () => {
  it("keeps usable rows in order, fills what's missing, and carries hidden", () => {
    expect(options.map((option) => option.entry)).toEqual([
      "tier:t1",
      "role:r1",
      "role:r2",
    ]);
    expect(options[2]).toMatchObject({
      user_ids: [],
      color: null,
      hidden: true,
    });
    expect(options[0]).not.toHaveProperty("hidden");
    expect(selectChannelAccessOptions(undefined)).toEqual([]);
  });
});

describe("reading a list", () => {
  it("counts each person once across entries", () => {
    expect(channelAccessReach(["tier:t1", "role:r1"], options)).toBe(3);
  });

  it("says everyone, the President alone, or the names", () => {
    expect(describeChannelAccess(null, "see", options)).toBe("Everyone");
    expect(describeChannelAccess(null, "post", options)).toBe(
      "Everyone who can see it",
    );
    expect(describeChannelAccess([], "see", options)).toBe(
      "Only the President",
    );
    expect(
      describeChannelAccess(["role:r1", "role:gone"], "see", options),
    ).toBe("Brothers, A removed role");
  });

  it("orders tiers before roles before a newer kind", () => {
    expect(["group", "role", "tier"].sort(compareChannelAccessKinds)).toEqual([
      "tier",
      "role",
      "group",
    ]);
  });

  it("matches a category by what the lists say, not their order", () => {
    const category = {
      who_can_see: ["role:r1", "tier:t1"],
      who_can_post: null,
    };
    expect(matchesCategoryAccess(["tier:t1", "role:r1"], null, category)).toBe(
      true,
    );
    expect(matchesCategoryAccess(null, null, category)).toBe(false);
    expect(matchesCategoryAccess(null, null, null)).toBe(false);
    expect(isEmptyChannelAccessChoice([])).toBe(true);
    expect(isEmptyChannelAccessChoice(null)).toBe(false);
  });
});
