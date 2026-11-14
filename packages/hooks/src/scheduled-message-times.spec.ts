import { describe, expect, it } from "vitest";
import {
  formatScheduledFor,
  scheduleTimeProblem,
  schedulePresets,
} from "./scheduled-message-times";

// Local-time constructors, so the cases read the same in any zone.
const at = (y: number, mo: number, d: number, h = 0, mi = 0) =>
  new Date(y, mo - 1, d, h, mi);

describe("schedulePresets", () => {
  it("offers tomorrow at 9 and next Monday at 9 on a weekday", () => {
    // Wednesday, Nov 11 2026.
    const presets = schedulePresets(at(2026, 11, 11, 22, 15));
    expect(presets.map((p) => p.key)).toEqual(["tomorrow", "monday"]);
    expect(presets[0].at).toEqual(at(2026, 11, 12, 9));
    expect(presets[1]?.at).toEqual(at(2026, 11, 16, 9));
  });

  it("offers only tomorrow on a Sunday, when tomorrow is Monday", () => {
    const presets = schedulePresets(at(2026, 11, 15, 21));
    expect(presets.map((p) => p.key)).toEqual(["tomorrow"]);
    expect(presets[0].at).toEqual(at(2026, 11, 16, 9));
  });

  it("offers the Monday a week out on a Monday", () => {
    const presets = schedulePresets(at(2026, 11, 16, 8));
    expect(presets[1]?.at).toEqual(at(2026, 11, 23, 9));
  });
});

describe("formatScheduledFor", () => {
  const now = at(2026, 11, 11, 22);
  it("says today and tomorrow by name", () => {
    expect(formatScheduledFor(at(2026, 11, 11, 23), now)).toMatch(/^Today at /);
    expect(formatScheduledFor(at(2026, 11, 12, 9), now)).toMatch(
      /^Tomorrow at /,
    );
  });
  it("names the year only when it isn't this one", () => {
    expect(formatScheduledFor(at(2026, 11, 20, 9), now)).not.toMatch(/2026/);
    expect(formatScheduledFor(at(2027, 1, 5, 9), now)).toMatch(/2027/);
  });
});

describe("scheduleTimeProblem", () => {
  const now = at(2026, 11, 11, 22);
  it("refuses the past, past 120 days, and no time at all", () => {
    expect(scheduleTimeProblem(at(2026, 11, 11, 21), now)).toMatch(/future/);
    expect(scheduleTimeProblem(at(2027, 3, 20), now)).toMatch(/120/);
    expect(scheduleTimeProblem(new Date(Number.NaN), now)).toMatch(/Pick/);
    expect(scheduleTimeProblem(at(2026, 11, 12, 9), now)).toBeNull();
  });
});
