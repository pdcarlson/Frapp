import { describe, expect, it } from "vitest";
import { showsAfterGraduation } from "./profile-copy";

const NOV_2026 = new Date("2026-11-06T12:00:00Z");

describe("showsAfterGraduation", () => {
  it("hides City and Company from an undergrad", () => {
    expect(showsAfterGraduation({ graduationYear: 2028 }, NOV_2026)).toBe(
      false,
    );
  });

  it("hides them while no graduation year is entered, or half of one", () => {
    expect(showsAfterGraduation({ graduationYear: null }, NOV_2026)).toBe(
      false,
    );
    expect(showsAfterGraduation({ graduationYear: 202 }, NOV_2026)).toBe(false);
  });

  it("shows them from the graduation year itself on", () => {
    expect(showsAfterGraduation({ graduationYear: 2026 }, NOV_2026)).toBe(true);
    expect(showsAfterGraduation({ graduationYear: 1998 }, NOV_2026)).toBe(true);
  });

  it("shows them to anyone who already has a value there, so it can be cleared", () => {
    expect(
      showsAfterGraduation({ graduationYear: 2028, city: "Troy" }, NOV_2026),
    ).toBe(true);
    expect(
      showsAfterGraduation(
        { graduationYear: null, city: "  ", company: "Acme" },
        NOV_2026,
      ),
    ).toBe(true);
    expect(
      showsAfterGraduation({ graduationYear: 2028, city: "   " }, NOV_2026),
    ).toBe(false);
  });
});
