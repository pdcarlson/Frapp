/**
 * These specs exist to catch a future merge that folds a protected cluster
 * into the generic locale formatter. A comment on the export is not enough —
 * each case uses an input where the generic formatter produces the wrong
 * result for that cluster's correctness behavior.
 *
 * TZ is America/Los_Angeles (vitest.config + package.json `test` script) so
 * a bare `YYYY-MM-DD` parsed as UTC midnight lands on the previous local day.
 */
import { describe, expect, it } from "vitest";
import {
  formatClock,
  formatLocaleDate,
  formatLocaleDateTime,
} from "./locale";
import {
  parseBareDateLocalMidnight,
  parseBareDateUtcNoon,
} from "./bare-date";
import { formatMinutesExact, formatMinutesRounded } from "./minutes";
import { formatPaddedStopwatch, formatTimer } from "./stopwatch";

const BARE = "2026-08-12";
const ELAPSED_SECONDS = 4 * 60 + 12; // 252 seconds → 04:12 / 4:12
const FRACTIONAL_MINUTES = 1.5;

describe("protected clusters stay distinct from the generic formatter", () => {
  it("runs west of Greenwich so a Date(date-only) fold is visible", () => {
    // UTC midnight on the 12th is still the 11th in America/Los_Angeles.
    expect(new Date(BARE).getDate()).toBe(11);
  });

  describe("1. stopwatch / timer padding", () => {
    it("zero-pads minutes; the generic datetime formatter does not produce mm:ss", () => {
      expect(formatPaddedStopwatch(ELAPSED_SECONDS)).toBe("04:12");
      expect(formatTimer(ELAPSED_SECONDS)).toBe("4:12");
      // Generic treats a number as unparseable, not as elapsed seconds.
      expect(formatLocaleDateTime(ELAPSED_SECONDS)).toBe("—");
      expect(formatClock(ELAPSED_SECONDS)).toBe("");
    });

    it("does not fold the padded web timer into the unpadded mobile timer", () => {
      expect(formatPaddedStopwatch(ELAPSED_SECONDS)).not.toBe(
        formatTimer(ELAPSED_SECONDS),
      );
    });

    it("is not a minute-duration string (seconds vs minutes)", () => {
      // 252 seconds is 04:12 on a stopwatch; 252 minutes is 4h 12m.
      expect(formatPaddedStopwatch(ELAPSED_SECONDS)).not.toBe(
        formatMinutesExact(ELAPSED_SECONDS),
      );
      expect(formatMinutesExact(ELAPSED_SECONDS)).toBe("4h 12m");
    });
  });

  describe("2. bare-date timezone parsing", () => {
    it("UTC noon keeps the submitted calendar day; generic Date(date-only) does not", () => {
      const noon = parseBareDateUtcNoon(BARE);
      const generic = new Date(BARE);
      expect(noon).not.toBeNull();
      expect(noon!.getDate()).toBe(12);
      expect(generic.getDate()).toBe(11);
      expect(formatLocaleDate(BARE)).toBe(generic.toLocaleDateString());
      expect(formatLocaleDate(BARE)).not.toBe(noon!.toLocaleDateString());
    });

    it("local midnight keeps the submitted local day; generic Date(date-only) does not", () => {
      const local = parseBareDateLocalMidnight(BARE);
      const generic = new Date(BARE);
      expect(local).not.toBeNull();
      expect(local!.getDate()).toBe(12);
      expect(local!.getHours()).toBe(0);
      expect(generic.getDate()).toBe(11);
      expect(formatLocaleDate(BARE)).not.toBe(local!.toLocaleDateString());
    });

    it("does not fold UTC noon into local midnight (they are different instants)", () => {
      expect(parseBareDateUtcNoon(BARE)!.getTime()).not.toBe(
        parseBareDateLocalMidnight(BARE)!.getTime(),
      );
    });
  });

  describe("3. minute-duration rounding", () => {
    it("rounded and exact disagree on a half minute; generic datetime is unrelated", () => {
      expect(formatMinutesExact(FRACTIONAL_MINUTES)).toBe("1.5m");
      expect(formatMinutesRounded(FRACTIONAL_MINUTES)).toBe("2m");
      expect(formatLocaleDateTime(FRACTIONAL_MINUTES)).toBe("—");
    });

    it("is not a stopwatch reading", () => {
      // 90 minutes → 1h 30m. 90 elapsed seconds → 01:30 / 1:30 on a stopwatch.
      expect(formatMinutesRounded(90)).toBe("1h 30m");
      expect(formatPaddedStopwatch(90)).toBe("01:30");
      expect(formatTimer(90)).toBe("1:30");
    });
  });
});
