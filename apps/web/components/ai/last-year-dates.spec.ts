import { describe, expect, it } from "vitest";
import { nameForThisYear, sameWeekdayThisYear } from "./last-year-dates";

describe("last-year dates (#3930)", () => {
  it("moves an event 52 weeks on, so its weekday stays", () => {
    const held = new Date("2025-12-06T21:00:00Z");
    const moved = sameWeekdayThisYear(
      held.toISOString(),
      new Date("2026-11-12T00:00:00Z"),
    )!;
    expect(moved.getDay()).toBe(held.getDay());
    expect(Math.round((moved.getTime() - held.getTime()) / 86_400_000)).toBe(
      364,
    );
  });

  it("never lands on a day already gone: the next same weekday still ahead", () => {
    const held = new Date("2025-11-15T21:00:00Z");
    // Its day this year was November 14; the officer opens it on the 20th.
    const moved = sameWeekdayThisYear(
      held.toISOString(),
      new Date("2026-11-20T12:00:00Z"),
    )!;
    expect(moved.toISOString()).toBe("2026-11-21T21:00:00.000Z");
    expect(moved.getDay()).toBe(held.getDay());
  });

  it("carries the year in a name forward, and only that year", () => {
    const start = new Date("2026-12-05T21:00:00Z");
    expect(
      nameForThisYear("Winter Formal 2025", "2025-12-06T21:00:00Z", start),
    ).toBe("Winter Formal 2026");
    expect(
      nameForThisYear("Room 2024 mixer", "2025-12-06T21:00:00Z", start),
    ).toBe("Room 2024 mixer");
    expect(nameForThisYear("Formal 20255", "2025-12-06T21:00:00Z", start)).toBe(
      "Formal 20255",
    );
    expect(nameForThisYear("Formal", "2025-12-06T21:00:00Z", start)).toBe(
      "Formal",
    );
    expect(nameForThisYear("Formal 2025", "not a date", start)).toBe(
      "Formal 2025",
    );
  });
});
