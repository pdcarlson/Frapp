import { describe, expect, it } from "vitest";
import {
  compareRolesByRank,
  highestRankedRole,
  sortRolesByRank,
  tierPositionsOf,
} from "./role-rank";

const positions = tierPositionsOf([
  { id: "cabinet", position: 1 },
  { id: "chairs", position: 2 },
  { id: "brothers", position: 4 },
]);

const president = {
  id: "pres",
  name: "President",
  display_order: 1,
  tier_id: "cabinet",
  permissions: ["*"],
};
const treasurer = {
  id: "tres",
  name: "Treasurer",
  display_order: 2,
  tier_id: "cabinet",
  permissions: [],
};
const recruitment = {
  id: "rec",
  name: "Recruitment Chair",
  display_order: 25,
  tier_id: "chairs",
};
const everyone = {
  id: "every",
  name: "Everyone",
  display_order: 5,
  tier_id: "brothers",
};
const firstFloor = {
  id: "floor",
  name: "First Floor",
  display_order: 0,
  tier_id: null,
};

describe("role rank", () => {
  it("puts a tiered role above an untiered one whatever their display_order", () => {
    // The staging bug: "First Floor" at 0 named Gabe's title over his office.
    expect(highestRankedRole([firstFloor, everyone], positions)).toBe(everyone);
    expect(highestRankedRole([firstFloor, recruitment], positions)).toBe(
      recruitment,
    );
  });

  it("orders by tier position, then the role's order in its tier", () => {
    expect(
      sortRolesByRank(
        [firstFloor, everyone, recruitment, treasurer, president],
        positions,
      ).map((role) => role.id),
    ).toEqual(["pres", "tres", "rec", "every", "floor"]);
  });

  it("ranks the wildcard role above every tier, wherever it sits", () => {
    const loosePresident = { ...president, tier_id: null };
    expect(highestRankedRole([treasurer, loosePresident], positions)).toBe(
      loosePresident,
    );
  });

  it("treats a tier the chapter no longer has as outside the tiers", () => {
    const stale = { ...treasurer, tier_id: "gone" };
    expect(highestRankedRole([stale, everyone], positions)).toBe(everyone);
  });

  it("breaks ties by name, then id, independent of input order", () => {
    const a = { id: "a", name: "Same", display_order: 3, tier_id: null };
    const b = { id: "b", name: "Same", display_order: 3, tier_id: null };
    expect(compareRolesByRank(a, b, positions)).toBeLessThan(0);
    expect(highestRankedRole([b, a], positions)).toBe(a);
  });

  it("returns null for no roles", () => {
    expect(highestRankedRole([], positions)).toBeNull();
  });
});
