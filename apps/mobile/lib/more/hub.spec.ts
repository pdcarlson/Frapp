import { describe, expect, it } from "vitest";
import { formatPointsLabel } from "./hub";

describe("formatPointsLabel", () => {
  it("groups thousands and pluralizes", () => {
    expect(formatPointsLabel(1240)).toBe("1,240 pts");
    expect(formatPointsLabel(1)).toBe("1 pt");
    expect(formatPointsLabel(0)).toBe("0 pts");
    expect(formatPointsLabel(-15)).toBe("-15 pts");
  });

  it("draws nothing while the balance is unknown", () => {
    expect(formatPointsLabel(null)).toBeNull();
  });
});
