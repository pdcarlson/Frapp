import { describe, expect, it } from "vitest";
import { POINT_CATEGORIES, pointCategoryLabel } from "./point-category";

describe("pointCategoryLabel", () => {
  it("labels every category the ledger enum carries in sentence case", () => {
    expect(POINT_CATEGORIES.map((category) => pointCategoryLabel(category))).toEqual([
      "Attendance",
      "Academic",
      "Study",
      "Service",
      "Fine",
      "Manual",
    ]);
  });

  it("reads a token regardless of its case", () => {
    expect(pointCategoryLabel("fine")).toBe("Fine");
  });

  it("returns null for a missing category instead of a placeholder", () => {
    expect(pointCategoryLabel(undefined)).toBeNull();
    expect(pointCategoryLabel(null)).toBeNull();
    expect(pointCategoryLabel("  ")).toBeNull();
  });

  it("sentence-cases a token it does not know rather than showing it raw", () => {
    expect(pointCategoryLabel("CHAPTER_BONUS")).toBe("Chapter bonus");
  });
});
