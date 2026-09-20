/**
 * TZ is America/Los_Angeles (vitest.config + package.json `test` script), so a
 * case that would only pass at UTC fails here.
 */
import { describe, expect, it } from "vitest";
import { parseInstant } from "./instant";
import { parseBareDateUtcNoon, parseInstantOrBareUtcNoon } from "./bare-date";
import { formatClock, formatLocaleDate, formatLocaleDateTime } from "./locale";

describe("parseInstant", () => {
  it("returns the parsed instant for a full ISO timestamp", () => {
    const parsed = parseInstant("2026-08-12T18:30:00Z");
    expect(parsed).not.toBeNull();
    expect(parsed!.getTime()).toBe(Date.parse("2026-08-12T18:30:00Z"));
  });

  it("returns null rather than an Invalid Date for an unreadable string", () => {
    // The whole point: `new Date` hands back an object that renders as the
    // string "Invalid Date" instead of throwing.
    expect(new Date("not-a-date").toString()).toBe("Invalid Date");
    expect(parseInstant("not-a-date")).toBeNull();
  });

  it("returns null for the empty string without constructing a Date", () => {
    expect(parseInstant("")).toBeNull();
  });

  it("returns null for every non-string, including ones Date would accept", () => {
    // `new Date(0)` and `new Date(date)` are both valid Dates, so a guard that
    // only tested `getTime()` would let a number or a Date through here.
    expect(new Date(0).getTime()).toBe(0);
    expect(parseInstant(0)).toBeNull();
    expect(parseInstant(new Date("2026-08-12T18:30:00Z"))).toBeNull();
    expect(parseInstant(null)).toBeNull();
    expect(parseInstant(undefined)).toBeNull();
    expect(parseInstant({})).toBeNull();
  });

  it("does not narrow a bare YYYY-MM-DD to the stored calendar day", () => {
    // This is the line between this primitive and the bare-date cluster: a
    // date-only string is UTC midnight here, which is the previous local day
    // west of Greenwich. `parseBareDateUtcNoon` is the member that fixes that,
    // and folding the two would silently re-break it.
    const bare = "2026-08-12";
    expect(parseInstant(bare)!.getDate()).toBe(11);
    expect(parseBareDateUtcNoon(bare)!.getDate()).toBe(12);
  });
});

describe("the members that parse through it keep their own behaviour", () => {
  it("locale formatters still render the placeholder on an unreadable value", () => {
    expect(formatLocaleDate("not-a-date")).toBe("—");
    expect(formatLocaleDateTime("not-a-date")).toBe("—");
    expect(formatLocaleDateTime(4)).toBe("—");
    expect(formatClock("not-a-date")).toBe("");
  });

  it("parseInstantOrBareUtcNoon still prefers the noon parse for a bare date", () => {
    const bare = "2026-08-12";
    expect(parseInstantOrBareUtcNoon(bare)!.getTime()).toBe(
      parseBareDateUtcNoon(bare)!.getTime(),
    );
  });

  it("parseInstantOrBareUtcNoon still falls through to the plain parse", () => {
    const instant = "2026-08-12T18:30:00Z";
    expect(parseBareDateUtcNoon(instant)).toBeNull();
    expect(parseInstantOrBareUtcNoon(instant)!.getTime()).toBe(
      Date.parse(instant),
    );
  });

  it("parseBareDateUtcNoon still rejects a malformed date that matches nothing", () => {
    expect(parseBareDateUtcNoon("2026-13-45")).toBeNull();
    expect(parseInstantOrBareUtcNoon("2026-13-45")).toBeNull();
  });
});
