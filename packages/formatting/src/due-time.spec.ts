import { describe, expect, it } from "vitest";
import {
  dueTimePassed,
  formatDueTimeLabel,
  splitDueEntry,
  suggestedDueTime,
} from "./due-time";

describe("formatDueTimeLabel", () => {
  it("writes the minutes only when there are some", () => {
    expect(formatDueTimeLabel("17:00")).toBe("5 PM");
    expect(formatDueTimeLabel("09:30")).toBe("9:30 AM");
    expect(formatDueTimeLabel("00:00")).toBe("12 AM");
    expect(formatDueTimeLabel("12:05")).toBe("12:05 PM");
  });
});

describe("suggestedDueTime", () => {
  it("starts at 5 PM, or the next hour today once 5 PM has passed", () => {
    const morning = new Date(2026, 8, 29, 9, 0);
    expect(suggestedDueTime("2026-09-29", morning)).toBe("17:00");
    const evening = new Date(2026, 8, 29, 18, 20);
    expect(suggestedDueTime("2026-09-29", evening)).toBe("19:00");
    expect(suggestedDueTime("2026-09-30", evening)).toBe("17:00");
    const late = new Date(2026, 8, 29, 23, 30);
    expect(suggestedDueTime("2026-09-29", late)).toBe("23:00");
  });
});

describe("dueTimePassed", () => {
  const now = new Date(2026, 8, 29, 18, 0);

  it("is false with no time, or a time still ahead", () => {
    expect(dueTimePassed({ dueDate: "2026-09-29" }, now)).toBe(false);
    expect(
      dueTimePassed({ dueDate: "2026-09-29", dueTime: "19:00" }, now),
    ).toBe(false);
  });

  it("doesn't refuse a task's own time for having passed, only a new one", () => {
    const kept = { dueDate: "2026-09-29", dueTime: "17:00" };
    expect(dueTimePassed(kept, now)).toBe(true);
    expect(dueTimePassed(kept, now, kept)).toBe(false);
    expect(
      dueTimePassed({ dueDate: "2026-09-29", dueTime: "17:30" }, now, kept),
    ).toBe(true);
  });
});

describe("splitDueEntry", () => {
  it("reads a day with or without a time", () => {
    expect(splitDueEntry("2026-09-29")).toEqual({
      dueDate: "2026-09-29",
      dueTime: null,
    });
    expect(splitDueEntry("2026-09-29T17:30")).toEqual({
      dueDate: "2026-09-29",
      dueTime: "17:30",
    });
    expect(splitDueEntry("")).toEqual({ dueDate: "", dueTime: null });
  });
});
