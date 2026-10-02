import { describe, expect, it } from "vitest";
import {
  formatBareDate,
  parseBareDateLocalMidnight,
  parseBareDateLocalNoon,
  parseInstantOrBareLocalNoon,
} from "./bare-date";

/**
 * Runs `fn` with the process in `zone`. Node re-reads `TZ` on assignment in a
 * process's main thread (vitest's default `forks` pool), not in a `threads`
 * worker, so the switch is checked rather than assumed.
 */
function inZone<T>(zone: string, fn: () => T): T {
  /* eslint-disable turbo/no-undeclared-env-vars -- the zone under test, not a
     build input: no turbo task's output depends on it. */
  const previous = process.env.TZ;
  process.env.TZ = zone;
  try {
    const active = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (active !== zone) {
      throw new Error(`inZone: asked for ${zone}, the process is in ${active}`);
    }
    return fn();
  } finally {
    // Assigning `undefined` would set the string "undefined", not unset it.
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
  /* eslint-enable turbo/no-undeclared-env-vars */
}

/**
 * The ends of the offset range, the half-hour and 45-minute zones, and a zone
 * each side of Greenwich. `Etc/GMT+12` is UTC−12 (POSIX signs are inverted).
 */
const ZONES = [
  "Pacific/Kiritimati", // +14
  "Pacific/Tongatapu", // +13
  "Pacific/Chatham", // +12:45 / +13:45
  "Pacific/Auckland", // +12 / +13
  "Asia/Kolkata", // +5:30
  "UTC",
  "America/Los_Angeles",
  "Pacific/Honolulu", // −10
  "Pacific/Pago_Pago", // −11
  "Etc/GMT+12", // −12
];

/** A month end, a year end, and the 2026 DST starts in Auckland and the US. */
const DATES: [string, number, number, number][] = [
  ["2026-09-30", 2026, 8, 30],
  ["2026-12-31", 2026, 11, 31],
  ["2026-09-27", 2026, 8, 27],
  ["2026-03-08", 2026, 2, 8],
];

describe("parseBareDateLocalNoon", () => {
  it("parses YYYY-MM-DD at local noon", () => {
    const date = parseBareDateLocalNoon("2026-08-12");
    expect(date).not.toBeNull();
    expect(date?.getDate()).toBe(12);
    expect(date?.getHours()).toBe(12);
  });

  it("lands on the stored calendar day in every zone from UTC−12 to UTC+14 (#3026)", () => {
    for (const zone of ZONES) {
      inZone(zone, () => {
        for (const [value, year, month, day] of DATES) {
          const date = parseBareDateLocalNoon(value)!;
          expect(
            [date.getFullYear(), date.getMonth(), date.getDate()],
            `${value} in ${zone}`,
          ).toEqual([year, month, day]);
          expect(formatBareDate(value), `${value} in ${zone}`).toBe(
            new Date(year, month, day).toLocaleDateString(),
          );
        }
      });
    }
  });

  it("would not with the UTC-noon parse it replaced", () => {
    // What `T12:00:00Z` did: already the next local day at +13 and +14, so a
    // test that only ran in UTC and Tokyo never saw it. (This pins the zones,
    // not the product code: the sweep above is the regression test.)
    for (const zone of ["Pacific/Kiritimati", "Pacific/Tongatapu"]) {
      inZone(zone, () => {
        expect(new Date("2026-09-30T12:00:00Z").getDate(), zone).toBe(1);
      });
    }
  });

  it("returns null for a full timestamp", () => {
    expect(parseBareDateLocalNoon("2026-08-12T19:02:00.000Z")).toBeNull();
  });
});

describe("parseBareDateLocalMidnight", () => {
  it("parses YYYY-MM-DD at local midnight", () => {
    const date = parseBareDateLocalMidnight("2026-08-12");
    expect(date).not.toBeNull();
    expect(date?.getDate()).toBe(12);
    expect(date?.getHours()).toBe(0);
    expect(date?.getMinutes()).toBe(0);
  });

  it("returns null for a full timestamp", () => {
    expect(parseBareDateLocalMidnight("2026-08-12T19:02:00.000Z")).toBeNull();
  });
});

describe("parseInstantOrBareLocalNoon", () => {
  it("uses local noon for a bare date", () => {
    const date = parseInstantOrBareLocalNoon("2026-08-12");
    expect(date?.getHours()).toBe(12);
    expect(date?.getTime()).toBe(
      parseBareDateLocalNoon("2026-08-12")?.getTime(),
    );
  });

  it("passes a full timestamp through", () => {
    const value = "2026-08-12T19:02:00.000Z";
    expect(parseInstantOrBareLocalNoon(value)?.toISOString()).toBe(value);
  });

  it("returns null for garbage", () => {
    expect(parseInstantOrBareLocalNoon("later")).toBeNull();
  });
});
