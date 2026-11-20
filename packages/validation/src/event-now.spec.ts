import { describe, expect, it } from "vitest";
import { EVENT_NOW_COPY, eventOnAt } from "./event-now";

// Recruitment Meetings, Thursday 2026-11-19, 9:25 to 10:25 PM local, check-in
// opening 10 minutes early: the meeting no screen showed (#5777).
const start = "2026-11-20T03:25:00.000Z";
const end = "2026-11-20T04:25:00.000Z";
const at = (iso: string) => Date.parse(iso);

describe("eventOnAt", () => {
  it("is on from when check-in opens until the end", () => {
    expect(eventOnAt(start, end, 10, at("2026-11-20T03:14:59.000Z"))).toBe(
      false,
    );
    expect(eventOnAt(start, end, 10, at("2026-11-20T03:15:00.000Z"))).toBe(
      true,
    );
    expect(eventOnAt(start, end, 10, at("2026-11-20T04:07:00.000Z"))).toBe(
      true,
    );
  });

  it("is off at the end, in the check-in grace too", () => {
    expect(eventOnAt(start, end, 10, at("2026-11-20T04:25:00.000Z"))).toBe(
      false,
    );
    expect(eventOnAt(start, end, 10, at("2026-11-20T04:35:00.000Z"))).toBe(
      false,
    );
  });

  it("starts at the start when check-in opens at it", () => {
    expect(eventOnAt(start, end, 0, at("2026-11-20T03:24:59.000Z"))).toBe(
      false,
    );
    expect(eventOnAt(start, end, 0, at("2026-11-20T03:25:00.000Z"))).toBe(true);
  });

  it("takes the default lead for a missing one", () => {
    expect(
      eventOnAt(start, end, undefined, at("2026-11-20T03:16:00.000Z")),
    ).toBe(true);
  });

  it("is never on for times that don't parse", () => {
    const now = at("2026-11-20T04:00:00.000Z");
    expect(eventOnAt("not a date", end, 10, now)).toBe(false);
    expect(eventOnAt(start, null, 10, now)).toBe(false);
  });
});

describe("EVENT_NOW_COPY", () => {
  it("indicates rather than narrates", () => {
    expect(EVENT_NOW_COPY.until("10:25 PM")).toBe("Now · until 10:25 PM");
    expect(EVENT_NOW_COPY.ended("10:25 PM")).toBe("Ended 10:25 PM");
    expect(EVENT_NOW_COPY.more(1)).toBe("+1 more on now");
    expect(EVENT_NOW_COPY.checkedIn("9:24 PM")).toBe("Checked in 9:24 PM");
    expect(EVENT_NOW_COPY.checkedIn(null)).toBe("Checked in");
  });
});
