import { describe, expect, it } from "vitest";
import type { TaskWho } from "@repo/validation";
import {
  createRequestOf,
  duePresets,
  formatDueFieldLabel,
  parsePointReward,
  taskCreatedLine,
  validateNewTask,
  whoTakesPhotos,
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
    who: { kind: "person", userId: "member-1" } as TaskWho | null,
    pointsInput: "5",
  };

  it("builds the request body CreateTaskDto expects", () => {
    const body = validateNewTask(draft);
    expect(body).toEqual({
      title: "Collect ride-share forms",
      who: { kind: "person", userId: "member-1" },
      due_date: "2026-08-21",
      point_reward: 5,
    });
    expect(createRequestOf(body!)).toEqual({
      route: "task",
      body: {
        title: "Collect ride-share forms",
        assignee_id: "member-1",
        due_date: "2026-08-21",
        point_reward: 5,
      },
    });
  });

  it("sends a repeating task's rule with it, never to Up for grabs (#5119)", () => {
    const rule = "FREQ=WEEKLY;BYDAY=FR;TZID=America/New_York";
    const body = { ...validateNewTask(draft)!, recurrence_rule: rule };
    expect(createRequestOf(body)).toEqual({
      route: "task",
      body: {
        title: "Collect ride-share forms",
        assignee_id: "member-1",
        due_date: "2026-08-21",
        point_reward: 5,
        recurrence_rule: rule,
      },
    });
    const open = createRequestOf({
      ...body,
      who: { kind: "someone", target: { kind: "chapter" } },
    });
    expect(open.route).toBe("open");
    expect(open.body).not.toHaveProperty("recurrence_rule");
  });

  it("sends a task for everyone as an audience, with no member (#4295 step 3)", () => {
    const body = validateNewTask({
      ...draft,
      who: { kind: "each", target: { kind: "chapter" } },
    });
    expect(createRequestOf(body!)).toEqual({
      route: "task",
      body: {
        title: "Collect ride-share forms",
        audience: "everyone",
        due_date: "2026-08-21",
        point_reward: 5,
      },
    });
  });

  it("sends a copy each for a role or several people (2026-11-18)", () => {
    const role = validateNewTask({
      ...draft,
      who: { kind: "each", target: { kind: "role", id: "r1" } },
    });
    expect(createRequestOf(role!).body).toMatchObject({
      audience: "everyone",
      audience_role_id: "r1",
    });
    const people = validateNewTask({
      ...draft,
      who: { kind: "each", target: { kind: "people", userIds: ["a", "b"] } },
    });
    expect(createRequestOf(people!).body).toMatchObject({
      assignee_ids: ["a", "b"],
    });
    // A list of one is that person.
    const one = validateNewTask({
      ...draft,
      who: { kind: "each", target: { kind: "people", userIds: ["a"] } },
    });
    expect(createRequestOf(one!).body).toMatchObject({ assignee_id: "a" });
  });

  it("posts one task up for grabs for someone in a set, without photos", () => {
    const body = validateNewTask({
      ...draft,
      who: { kind: "someone", target: { kind: "group", id: "g1" } },
    });
    expect(
      createRequestOf({ ...body!, reference_photo_paths: ["p.jpg"] }),
    ).toEqual({
      route: "open",
      body: {
        title: "Collect ride-share forms",
        due_date: "2026-08-21",
        point_reward: 5,
        group_id: "g1",
      },
    });
    expect(
      whoTakesPhotos({ kind: "someone", target: { kind: "chapter" } }),
    ).toBe(false);
    expect(whoTakesPhotos({ kind: "person", userId: "a" })).toBe(true);
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
    expect(validateNewTask({ ...draft, who: null })).toBeNull();
    expect(
      validateNewTask({
        ...draft,
        who: { kind: "each", target: { kind: "people", userIds: [] } },
      }),
    ).toBeNull();
    expect(validateNewTask({ ...draft, dueDate: "21/08/2026" })).toBeNull();
    expect(validateNewTask({ ...draft, pointsInput: "-4" })).toBeNull();
  });
});

describe("taskCreatedLine", () => {
  it("says a task up for grabs was posted there, not assigned", () => {
    expect(taskCreatedLine("Sam", false)).toBe("Assigned to Sam.");
    expect(taskCreatedLine(null, false, true)).toBe("Posted to Up for grabs.");
  });
});

describe("validateNewTask proof kind (#4635)", () => {
  const base = {
    title: "Sweep",
    dueDate: "2026-09-29",
    who: { kind: "person", userId: "u1" } as TaskWho | null,
    pointsInput: "",
  };
  it("sends a proof kind only when it asks for something", () => {
    const now = new Date(2026, 8, 27, 12);
    expect(
      validateNewTask({ ...base, proofKind: "none" }, now),
    ).not.toHaveProperty("proof_kind");
    expect(validateNewTask({ ...base, proofKind: "photo" }, now)).toMatchObject(
      {
        proof_kind: "photo",
      },
    );
  });
});
