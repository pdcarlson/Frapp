import { describe, expect, it } from "vitest";
import { selectHouseRank, selectPointsSummary } from "./points-card";

const ME = "viewer-1";

describe("selectPointsSummary", () => {
  it("reads the balance the points service returns", () => {
    expect(selectPointsSummary({ balance: 1240, transactions: [] })).toEqual({
      balance: 1240,
    });
  });

  it("keeps a real zero distinct from an unresolved read", () => {
    // The card draws 0 and — differently; conflating them headlines a zero at a
    // member who has 1,240 points.
    expect(selectPointsSummary({ balance: 0 })).toEqual({ balance: 0 });
  });

  it("returns null for anything it cannot read", () => {
    for (const value of [null, undefined, {}, [], "x", { balance: "1240" }]) {
      expect(selectPointsSummary(value)).toBeNull();
    }
  });

  it("rejects NaN rather than letting it spread through arithmetic", () => {
    expect(selectPointsSummary({ balance: Number.NaN })).toBeNull();
  });
});

describe("selectHouseRank", () => {
  const board = [
    { user_id: "a", total: 2000 },
    { user_id: "b", total: 1500 },
    { user_id: ME, total: 1240 },
    { user_id: "d", total: 900 },
  ];

  it("ranks the viewer against the whole leaderboard", () => {
    expect(selectHouseRank(board, ME)).toEqual({ rank: 3, of: 4 });
  });

  it("uses competition ranking, so ties share a place", () => {
    // Two members on 1,240 are both #3 and the next is #5 — an array index
    // would hand one of them #4.
    const tied = [
      { user_id: "a", total: 2000 },
      { user_id: "b", total: 1500 },
      { user_id: "c", total: 1240 },
      { user_id: ME, total: 1240 },
      { user_id: "e", total: 900 },
    ];
    expect(selectHouseRank(tied, ME)).toEqual({ rank: 3, of: 5 });
    expect(selectHouseRank(tied, "e")).toEqual({ rank: 5, of: 5 });
  });

  it("returns null when the viewer has no standing to report", () => {
    // A member with no transactions this window is absent from the leaderboard;
    // the card draws an em dash, not a last place they did not earn.
    expect(selectHouseRank(board, "stranger")).toBeNull();
    expect(selectHouseRank([], ME)).toBeNull();
    expect(selectHouseRank(board, null)).toBeNull();
  });

  it("returns null for anything it cannot read", () => {
    for (const value of [null, undefined, {}, "x"]) {
      expect(selectHouseRank(value, ME)).toBeNull();
    }
  });

  it("skips malformed rows without losing the ranking", () => {
    const messy = [
      { user_id: "a", total: 2000 },
      { user_id: "b" },
      { total: 1500 },
      { user_id: ME, total: 1240 },
    ];
    expect(selectHouseRank(messy, ME)).toEqual({ rank: 2, of: 2 });
  });
});
