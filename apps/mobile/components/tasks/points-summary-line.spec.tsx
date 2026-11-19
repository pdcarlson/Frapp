import { describe, expect, it } from "vitest";
import { pointsSummaryText } from "./points-summary-line";

// #5570: the board's points card became one muted line.
describe("pointsSummaryText", () => {
  it("says the balance and the rank on one line", () => {
    expect(pointsSummaryText({ balance: 1240 }, { rank: 3, of: 42 })).toBe(
      `${(1240).toLocaleString()} semester points · #3 of 42 in the house`,
    );
  });

  it("leaves out a half it doesn't know, and says nothing with neither", () => {
    expect(pointsSummaryText(null, { rank: 1, of: 5 })).toBe(
      "#1 of 5 in the house",
    );
    expect(pointsSummaryText({ balance: 1 }, null)).toBe("1 semester point");
    expect(pointsSummaryText(null, null)).toBeNull();
  });

  it("says a real zero", () => {
    expect(pointsSummaryText({ balance: 0 }, null)).toBe("0 semester points");
  });
});
