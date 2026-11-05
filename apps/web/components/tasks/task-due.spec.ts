import { describe, expect, it } from "vitest";
import { taskDueClause } from "./task-due";

// Local noon on a Thursday, so "tomorrow" and the weekday forms are stable.
const NOW = new Date(2026, 10, 5, 12, 0, 0);

describe("taskDueClause", () => {
  it("reads an upcoming bare date relative to today", () => {
    expect(
      taskDueClause({ due_date: "2026-11-06", status: "TODO" }, NOW),
    ).toEqual({ text: "Due tomorrow", overdue: false });
  });

  it("marks a past date on open work as overdue", () => {
    expect(
      taskDueClause({ due_date: "2026-11-03", status: "IN_PROGRESS" }, NOW),
    ).toEqual({ text: "Overdue by 2 days", overdue: true });
  });

  it("takes the overdue tone for an OVERDUE task even on its due day", () => {
    expect(
      taskDueClause({ due_date: "2026-11-05", status: "OVERDUE" }, NOW),
    ).toEqual({ text: "Due today", overdue: true });
  });

  it("gives handed-in work the plain day instead of an overdue count", () => {
    const clause = taskDueClause(
      { due_date: "2026-11-03", status: "COMPLETED" },
      NOW,
    );
    expect(clause?.overdue).toBe(false);
    expect(clause?.text).toMatch(/^Due Nov 3$/);
  });

  it("drops the clause when the date is missing", () => {
    expect(taskDueClause({ due_date: "", status: "TODO" }, NOW)).toBeNull();
    expect(taskDueClause({ due_date: null, status: "TODO" }, NOW)).toBeNull();
  });
});
