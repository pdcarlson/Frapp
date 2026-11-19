import { describe, expect, it } from "vitest";
import {
  CHECK_IN_GRACE_MINUTES,
  DEFAULT_CHECK_IN_OPENS_MINUTES,
  MAX_CHECK_IN_OPENS_MINUTES,
  CHECK_IN_OPENS_ERROR,
  checkInOpensMinutes,
  checkInWindowBounds,
  parseCheckInOpens,
} from "./check-in-window";

describe("checkInOpensMinutes", () => {
  it("keeps an event's own lead, zero included", () => {
    expect(checkInOpensMinutes(0)).toBe(0);
    expect(checkInOpensMinutes(30)).toBe(30);
    expect(checkInOpensMinutes(MAX_CHECK_IN_OPENS_MINUTES)).toBe(
      MAX_CHECK_IN_OPENS_MINUTES,
    );
  });

  it("falls back to the default for a missing or impossible value", () => {
    for (const value of [undefined, null, "10", -1, 2.5, NaN, 121]) {
      expect(checkInOpensMinutes(value)).toBe(DEFAULT_CHECK_IN_OPENS_MINUTES);
    }
  });
});

describe("checkInWindowBounds", () => {
  const start = new Date("2026-11-07T20:00:00Z");
  const end = new Date("2026-11-07T21:00:00Z");

  it("opens the event's lead before the start and closes after the grace", () => {
    const { opensAt, closesAt } = checkInWindowBounds(start, end, 25);
    expect(opensAt.toISOString()).toBe("2026-11-07T19:35:00.000Z");
    expect(closesAt.getTime() - end.getTime()).toBe(
      CHECK_IN_GRACE_MINUTES * 60_000,
    );
  });

  it("opens ten minutes early for a row without a lead", () => {
    expect(checkInWindowBounds(start, end, undefined).opensAt.toISOString()).toBe(
      "2026-11-07T19:50:00.000Z",
    );
  });
});

describe("parseCheckInOpens", () => {
  it("reads whole minutes up to the cap, and an empty field as the default", () => {
    expect(parseCheckInOpens(" 30 ")).toBe(30);
    expect(parseCheckInOpens("0")).toBe(0);
    expect(parseCheckInOpens(String(MAX_CHECK_IN_OPENS_MINUTES))).toBe(
      MAX_CHECK_IN_OPENS_MINUTES,
    );
    expect(parseCheckInOpens("")).toBe(DEFAULT_CHECK_IN_OPENS_MINUTES);
  });

  it("refuses a fraction, a sign, words, or a lead past the cap", () => {
    for (const input of ["2.5", "-5", "ten", String(MAX_CHECK_IN_OPENS_MINUTES + 1)]) {
      expect(parseCheckInOpens(input)).toBeNull();
    }
    expect(CHECK_IN_OPENS_ERROR).toContain(String(MAX_CHECK_IN_OPENS_MINUTES));
  });
});
