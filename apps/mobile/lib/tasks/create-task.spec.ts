import { describe, expect, it } from "vitest";
import {
  duePresets,
  dueTimePassed,
  editDraftOf,
  formatDueFieldLabel,
  taskEditBody,
  parsePointReward,
  validateNewTask,
} from "./create-task";

function at(year: number, month: number, day: number, hour = 12): Date {
  return new Date(year, month - 1, day, hour, 0, 0, 0);
}

const ids = (presets: { id: string }[]) => presets.map((p) => p.id);
const dates = (presets: { date: string }[]) => presets.map((p) => p.date);

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
    expect(formatDueFieldLabel("2026-08-21", at(2026, 8, 1))).toBe(
      "Fri, Aug 21",
    );
  });

  it("shows the year on a date outside the current one (#3928)", () => {
    expect(formatDueFieldLabel("2027-03-14", at(2026, 11, 9))).toBe(
      "Sun, Mar 14, 2027",
    );
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
    expect(parsePointReward("100000")).toEqual({
      kind: "value",
      points: 100000,
    });
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
    expect(
      validateNewTask({ ...draft, title: "a".repeat(255) }),
    ).not.toBeNull();
    expect(validateNewTask({ ...draft, title: "a".repeat(256) })).toBeNull();
  });

  it("sends the typed steps in order, dropping blank ones (#4003)", () => {
    expect(
      validateNewTask({
        ...draft,
        subtasks: ["  Counters ", "", "Floor", "   "],
      })?.subtasks,
    ).toEqual(["Counters", "Floor"]);
    const none = validateNewTask({ ...draft, subtasks: ["", " "] });
    expect(none && "subtasks" in none).toBe(false);
  });

  it("refuses a draft the server would reject", () => {
    expect(validateNewTask({ ...draft, title: "   " })).toBeNull();
    expect(validateNewTask({ ...draft, assigneeId: null })).toBeNull();
    expect(validateNewTask({ ...draft, dueDate: "21/08/2026" })).toBeNull();
    expect(validateNewTask({ ...draft, pointsInput: "-4" })).toBeNull();
  });
});

describe("editing a task (#4296)", () => {
  const task = {
    id: "t1",
    title: "Sweep",
    assigneeId: "u1",
    dueDay: "2026-09-29",
    dueAt: null as string | null,
    pointReward: 5 as number | null,
    storedStatus: "TODO",
  };

  it("opens a timed task on its local day and time", () => {
    const at = new Date(2026, 8, 29, 17, 30);
    const draft = editDraftOf({ ...task, dueAt: at.toISOString() });
    expect(draft).toMatchObject({
      title: "Sweep",
      dueDate: "2026-09-29",
      dueTime: "17:30",
      assigneeId: "u1",
      pointsInput: "5",
    });
  });

  it("sends only the changed fields, the due as a pair", () => {
    expect(
      taskEditBody(task, {
        title: "Sweep",
        assignee_id: "u1",
        due_date: "2026-09-29",
        point_reward: 5,
      }),
    ).toEqual({});
    const at = new Date(2026, 8, 29, 17, 0).toISOString();
    expect(
      taskEditBody(task, {
        title: "Mop",
        assignee_id: "u2",
        due_date: "2026-09-29",
        due_at: at,
      }),
    ).toEqual({
      title: "Mop",
      assignee_id: "u2",
      due_date: "2026-09-29",
      due_at: at,
      point_reward: null,
    });
  });

  it("takes the time off with due_at null", () => {
    const at = new Date(2026, 8, 29, 17, 0).toISOString();
    expect(
      taskEditBody(
        { ...task, dueAt: at },
        {
          title: "Sweep",
          assignee_id: "u1",
          due_date: "2026-09-29",
          point_reward: 5,
        },
      ),
    ).toEqual({ due_date: "2026-09-29", due_at: null });
  });

  it("doesn't refuse a task's own time for having passed, only a new one", () => {
    const now = new Date(2026, 8, 29, 18, 0);
    const kept = { dueDate: "2026-09-29", dueTime: "17:00" };
    expect(dueTimePassed(kept, now)).toBe(true);
    expect(dueTimePassed(kept, now, kept)).toBe(false);
    expect(
      dueTimePassed({ dueDate: "2026-09-29", dueTime: "17:30" }, now, kept),
    ).toBe(true);
  });
});
