import { describe, expect, it } from "vitest";
import { localIsoDate } from "@repo/formatting";
import { parseCalendarDayParam } from "./calendar-day";

describe("parseCalendarDayParam (#5310)", () => {
  it("reads a local calendar day back as its local midnight", () => {
    const day = parseCalendarDayParam("2026-11-17");
    expect(day).toEqual(new Date(2026, 10, 17));
    // The month's day heading writes the param with `localIsoDate`.
    expect(localIsoDate(day!)).toBe("2026-11-17");
  });

  it("is null for anything that isn't a real day", () => {
    expect(parseCalendarDayParam(undefined)).toBeNull();
    expect(parseCalendarDayParam("")).toBeNull();
    expect(parseCalendarDayParam("2026-11-17T00:00:00Z")).toBeNull();
    expect(parseCalendarDayParam("17/11/2026")).toBeNull();
    expect(parseCalendarDayParam("2026-02-30")).toBeNull();
  });
});
