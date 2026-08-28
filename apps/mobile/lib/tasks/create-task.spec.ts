import { describe, expect, it } from "vitest";
import {
  duePresets,
  formatDueFieldLabel,
  localIsoDate,
  parsePointReward,
  validateNewTask,
} from "./create-task";

function at(year: number, month: number, day: number, hour = 12): Date {
  return new Date(year, month - 1, day, hour, 0, 0, 0);
}

const ids = (presets: { id: string }[]) => presets.map((p) => p.id);
const dates = (presets: { date: string }[]) => presets.map((p) => p.date);

describe("localIsoDate", () => {
  it("uses the device's own day, not UTC's", () => {
    // 11pm local on the 17th is already the 18th in UTC — a "Today" preset must
    // not file a task due tomorrow.
    expect(localIsoDate(at(2026, 8, 17, 23))).toBe("2026-08-17");
  });

  it("pads single-digit months and days", () => {
    expect(localIsoDate(at(2026, 1, 5))).toBe("2026-01-05");
  });
});

describe("duePresets", () => {
  it("offers today, tomorrow, Friday and next week from a Monday", () => {
    // 2026-08-17 is a Monday.
    const presets = duePresets(at(2026, 8, 17));
    expect(ids(presets)).toEqual(["today", "tomorrow", "friday", "next-week"]);
    expect(dates(presets)).toEqual([
      "2026-08-17",
      "2026-08-18",
      "2026-08-21",
      "2026-08-24",
    ]);
  });

  it("drops Friday when it would duplicate today or tomorrow", () => {
    // Friday itself, and Thursday (whose Friday is already "Tomorrow").
    expect(ids(duePresets(at(2026, 8, 21)))).toEqual([
      "today",
      "tomorrow",
      "next-week",
    ]);
    expect(ids(duePresets(at(2026, 8, 20)))).toEqual([
      "today",
      "tomorrow",
      "next-week",
    ]);
  });

  it("rolls over a month boundary", () => {
    const presets = duePresets(at(2026, 8, 30));
    expect(dates(presets)).toContain("2026-08-31");
    expect(dates(presets)).toContain("2026-09-06");
  });

  it("rolls over a year boundary", () => {
    const presets = duePresets(at(2026, 12, 29));
    expect(dates(presets)).toContain("2026-12-30");
    expect(dates(presets)).toContain("2027-01-05");
  });
});

describe("formatDueFieldLabel", () => {
  it("renders the drawn weekday-and-date label", () => {
    expect(formatDueFieldLabel("2026-08-21")).toBe("Fri, Aug 21");
  });

  it("falls back to the raw value rather than showing Invalid Date", () => {
    expect(formatDueFieldLabel("nonsense")).toBe("nonsense");
  });
});

describe("parsePointReward", () => {
  it("treats a blank field as no reward offered", () => {
    // Distinct from invalid — the drawn LATER row carries no chip at all.
    expect(parsePointReward("")).toEqual({ kind: "omit" });
    expect(parsePointReward("   ")).toEqual({ kind: "omit" });
  });

  it("accepts whole points inside the ledger bound", () => {
    expect(parsePointReward("0")).toEqual({ kind: "value", points: 0 });
    expect(parsePointReward("5")).toEqual({ kind: "value", points: 5 });
    expect(parsePointReward("100000")).toEqual({ kind: "value", points: 100000 });
  });

  it("rejects anything the DTO would", () => {
    for (const value of ["100001", "-1", "5.5", "abc", "1e3", "١٢"]) {
      expect(parsePointReward(value)).toEqual({ kind: "invalid" });
    }
  });
});

describe("validateNewTask", () => {
  const draft = {
    title: "Collect ride-share forms",
    dueDate: "2026-08-21",
    assigneeId: "member-1",
    pointsInput: "5",
  };

  it("builds the request body CreateTaskDto expects", () => {
    expect(validateNewTask(draft)).toEqual({
      title: "Collect ride-share forms",
      assignee_id: "member-1",
      due_date: "2026-08-21",
      point_reward: 5,
    });
  });

  it("omits point_reward when no points are offered", () => {
    const body = validateNewTask({ ...draft, pointsInput: "" });
    expect(body).not.toBeNull();
    expect(body && "point_reward" in body).toBe(false);
  });

  it("trims the title and enforces the 255-char bound", () => {
    expect(validateNewTask({ ...draft, title: "  Spaced  " })?.title).toBe(
      "Spaced",
    );
    expect(validateNewTask({ ...draft, title: "a".repeat(255) })).not.toBeNull();
    expect(validateNewTask({ ...draft, title: "a".repeat(256) })).toBeNull();
  });

  it("refuses a draft the server would reject", () => {
    expect(validateNewTask({ ...draft, title: "   " })).toBeNull();
    expect(validateNewTask({ ...draft, assigneeId: null })).toBeNull();
    expect(validateNewTask({ ...draft, dueDate: "21/08/2026" })).toBeNull();
    expect(validateNewTask({ ...draft, pointsInput: "-4" })).toBeNull();
  });
});
