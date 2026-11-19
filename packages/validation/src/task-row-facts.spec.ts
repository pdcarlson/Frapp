import { describe, expect, it } from "vitest";
import { taskRowFacts } from "./task-row-facts";

const WEEKLY = {
  recurrence_rule: "FREQ=WEEKLY;INTERVAL=1;BYDAY=MO;TZID=America/New_York",
  next_due_date: "2026-11-27",
  ended: false,
};

describe("taskRowFacts", () => {
  it("says how it repeats, its checklist and its reference photos", () => {
    expect(
      taskRowFacts({
        done: false,
        subtasksDone: 2,
        subtasksTotal: 5,
        photos: [{ kind: "reference" }, { kind: "proof" }],
        series: WEEKLY,
      }),
    ).toEqual({
      cadence: "Weekly",
      progress: "2 of 5",
      photos: "1 photo",
      shown: "↻ Weekly · 2 of 5 · 1 photo",
      spoken: "repeats weekly, 2 of 5, 1 photo",
    });
  });

  it("drops what a task doesn't have", () => {
    expect(
      taskRowFacts({ done: false, subtasksDone: 0, subtasksTotal: 0 }),
    ).toEqual({
      cadence: null,
      progress: null,
      photos: null,
      shown: null,
      spoken: null,
    });
  });

  it("drops everything once the task is done", () => {
    expect(
      taskRowFacts({
        done: true,
        subtasksDone: 5,
        subtasksTotal: 5,
        photos: [{ kind: "reference" }],
        series: WEEKLY,
      }),
    ).toEqual({
      cadence: null,
      progress: null,
      photos: null,
      shown: null,
      spoken: null,
    });
  });
});
