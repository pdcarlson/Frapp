import { describe, expect, it, vi } from "vitest";

// The device's zone, pinned: `repeatEditAnchor` steps a legacy token on it.
vi.mock("./time-zone", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./time-zone")>()),
  localTimeZone: () => "America/New_York",
}));

const { repeatEditAnchor } = await import("./repeat-draft");

describe("repeatEditAnchor on a legacy series", () => {
  // #4505: Thu 2027-02-25, 7 PM in New York; DST starts Sun 2027-03-14. The
  // API now makes a token's meetings on the saving officer's wall clock, so
  // the next meeting after the change is 7 PM EDT (23:00Z), not 00:00Z.
  it("reads the next meeting on the device's wall clock", () => {
    const anchor = repeatEditAnchor({
      headStart: new Date("2027-02-26T00:00:00Z"),
      headRule: "WEEKLY",
      shiftMs: 0,
      now: new Date("2027-03-15T12:00:00Z"),
    });
    expect(anchor.toISOString()).toBe("2027-03-18T23:00:00.000Z");
  });
});
