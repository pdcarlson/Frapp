import { describe, expect, it } from "vitest";
import { formatTimer } from "@repo/formatting";
import {
  formatHoursLabel,
  formatHoursValue,
  formatSessionRange,
  startOfWeek,
} from "./format";

describe("formatTimer", () => {
  it("renders the drawn over-an-hour reading", () => {
    expect(formatTimer(1 * 3600 + 24 * 60 + 36)).toBe("1:24:36");
  });

  it("drops the hour segment below an hour rather than padding a meaningless zero", () => {
    expect(formatTimer(4 * 60 + 12)).toBe("4:12");
    expect(formatTimer(9)).toBe("0:09");
  });

  it("floors partial seconds instead of rounding a second the member has not earned", () => {
    expect(formatTimer(59.9)).toBe("0:59");
  });

  it("never renders a negative clock", () => {
    expect(formatTimer(-10)).toBe("0:00");
  });
});

describe("formatHoursLabel", () => {
  it("renders one decimal, as drawn", () => {
    expect(formatHoursLabel(126)).toBe("2.1 hrs");
    expect(formatHoursLabel(108)).toBe("1.8 hrs");
  });

  it("uses the singular only at exactly one hour", () => {
    expect(formatHoursLabel(60)).toBe("1.0 hr");
    expect(formatHoursLabel(66)).toBe("1.1 hrs");
    expect(formatHoursLabel(0)).toBe("0.0 hrs");
  });

  it("never renders a negative duration", () => {
    expect(formatHoursLabel(-60)).toBe("0.0 hrs");
  });
});

describe("formatHoursValue", () => {
  it("is the bare number the week summary leads with", () => {
    expect(formatHoursValue(324)).toBe("5.4");
    expect(formatHoursValue(0)).toBe("0.0");
  });
});

describe("formatSessionRange", () => {
  it("renders weekday, start and end with the drawn en dash", () => {
    const meta = formatSessionRange(
      "2026-08-18T19:02:00.000Z",
      "2026-08-18T21:10:00.000Z",
    );
    expect(meta).toContain(" · ");
    expect(meta).toContain(" – ");
  });

  it("degrades to the start alone rather than dangling a dash", () => {
    const meta = formatSessionRange("2026-08-18T19:02:00.000Z", null);
    expect(meta).not.toContain("–");
    expect(meta).not.toBeNull();
  });

  it("returns null for a timestamp it cannot read", () => {
    expect(formatSessionRange("later", null)).toBeNull();
  });
});

describe("startOfWeek", () => {
  it("returns local Sunday midnight", () => {
    // A Tuesday.
    const start = startOfWeek(new Date(2026, 7, 18, 21, 30, 0));
    expect(start.getDay()).toBe(0);
    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
    expect(start.getDate()).toBe(16);
  });

  it("is already Sunday midnight when called on a Sunday evening", () => {
    // The case UTC bucketing gets wrong: 9pm Sunday local is Monday in UTC for
    // anyone east of Greenwich and still Sunday for anyone west, so a UTC week
    // boundary would disagree with the calendar the member is reading.
    const start = startOfWeek(new Date(2026, 7, 16, 21, 0, 0));
    expect(start.getDate()).toBe(16);
    expect(start.getHours()).toBe(0);
  });

  it("steps back across a month boundary", () => {
    // 2026-09-01 is a Tuesday, so its week starts in August.
    const start = startOfWeek(new Date(2026, 8, 1, 12, 0, 0));
    expect(start.getMonth()).toBe(7);
    expect(start.getDate()).toBe(30);
  });
});
