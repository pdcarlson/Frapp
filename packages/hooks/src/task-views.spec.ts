import { describe, expect, it } from "vitest";
import {
  compareTasksByDue,
  myTasksGroup,
  taskDueBucket,
} from "./task-views";

// Thursday, Nov 12 2026, noon local.
const NOW = new Date(2026, 10, 12, 12);

describe("taskDueBucket (#4295 step 5)", () => {
  it("places an open task by its due day from today", () => {
    expect(taskDueBucket({ due_date: "2026-11-12", status: "TODO" }, NOW)).toBe(
      "today",
    );
    expect(taskDueBucket({ due_date: "2026-11-13", status: "TODO" }, NOW)).toBe(
      "week",
    );
    // Today plus six days is still This week; the seventh is Later.
    expect(taskDueBucket({ due_date: "2026-11-18", status: "TODO" }, NOW)).toBe(
      "week",
    );
    expect(taskDueBucket({ due_date: "2026-11-19", status: "TODO" }, NOW)).toBe(
      "later",
    );
  });

  it("trusts the server's OVERDUE, and calls an open task past its day overdue", () => {
    expect(
      taskDueBucket({ due_date: "2026-11-12", status: "OVERDUE" }, NOW),
    ).toBe("overdue");
    expect(
      taskDueBucket({ due_date: "2026-11-10", status: "IN_PROGRESS" }, NOW),
    ).toBe("overdue");
  });

  it("never calls a finished task overdue", () => {
    expect(
      taskDueBucket({ due_date: "2026-11-10", status: "COMPLETED" }, NOW),
    ).toBe("earlier");
  });

  it("places a timed task by that moment's local day", () => {
    const tomorrowMorning = new Date(2026, 10, 13, 9).toISOString();
    expect(
      taskDueBucket(
        { due_date: "2026-11-13", due_at: tomorrowMorning, status: "TODO" },
        NOW,
      ),
    ).toBe("week");
  });

  it("keeps a task with an unreadable date, as Later", () => {
    expect(taskDueBucket({ due_date: "banana", status: "TODO" }, NOW)).toBe(
      "later",
    );
  });
});

describe("myTasksGroup", () => {
  it("folds overdue into Today", () => {
    expect(
      myTasksGroup({ due_date: "2026-11-01", status: "OVERDUE" }, NOW),
    ).toBe("today");
    expect(myTasksGroup({ due_date: "2026-11-30", status: "TODO" }, NOW)).toBe(
      "later",
    );
  });
});

describe("compareTasksByDue", () => {
  const task = (
    title: string,
    due_date: string,
    status: "TODO" | "OVERDUE" = "TODO",
    due_at: string | null = null,
  ) => ({ title, due_date, status, due_at });

  it("leads with overdue, then day, then time with an untimed task last, then title", () => {
    const rows = [
      task("b untimed", "2026-11-12"),
      task("a untimed", "2026-11-12"),
      task("timed", "2026-11-12", "TODO", new Date(2026, 10, 12, 15).toISOString()),
      task("late", "2026-11-20", "OVERDUE"),
      task("earlier day", "2026-11-11"),
    ];
    expect(rows.sort(compareTasksByDue).map((row) => row.title)).toEqual([
      "late",
      "earlier day",
      "timed",
      "a untimed",
      "b untimed",
    ]);
  });
});
