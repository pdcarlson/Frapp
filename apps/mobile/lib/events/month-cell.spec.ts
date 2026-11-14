import { describe, expect, it } from "vitest";
import type { CalendarItem } from "@repo/hooks/calendar-tasks";
import { monthCellSummary } from "./month-cell";
import type { EventRow } from "./select";

function event(id: string, name: string, hour: number, required = false) {
  return {
    id,
    name,
    location: null,
    start_time: `2026-11-16T${String(hour).padStart(2, "0")}:00:00.000Z`,
    end_time: `2026-11-16T${String(hour + 1).padStart(2, "0")}:00:00.000Z`,
    point_value: null,
    check_in_opens_minutes: 15,
    attendance: { required } as unknown as EventRow["attendance"],
    recurrence_rule: null,
    parent_event_id: null,
  } satisfies EventRow;
}

const requiredOf = (fields: EventRow["attendance"]) =>
  (fields as unknown as { required: boolean }).required;

function task(key: string, overdue = false): CalendarItem {
  return {
    kind: "mine",
    key,
    title: key,
    day: "2026-11-16",
    state: overdue ? "overdue" : "open",
    taskId: key,
    label: overdue ? "Overdue" : "To do",
    createdBy: null,
  };
}

function birthday(key: string, title: string): CalendarItem {
  return { kind: "birthdays", key, title, userId: key, day: "2026-11-16" };
}

describe("monthCellSummary", () => {
  it("writes the day's events by start time, then its birthdays", () => {
    const cell = monthCellSummary(
      [event("b", "Chapter Meeting", 20, true), event("a", "Exec Sync", 15)],
      [birthday("u1", "Ava Chen")],
      requiredOf,
    );
    expect(cell.lines).toEqual([
      { kind: "event", key: "a", title: "Exec Sync", required: false },
      { kind: "event", key: "b", title: "Chapter Meeting", required: true },
      { kind: "birthday", key: "u1", title: "Ava Chen" },
    ]);
    expect(cell.hidden).toBe(0);
    expect(cell.birthdayCount).toBe(1);
  });

  it("folds what doesn't fit into a count when the line under is needed", () => {
    const cell = monthCellSummary(
      [event("a", "One", 13), event("b", "Two", 14), event("c", "Three", 15)],
      [task("t1")],
      requiredOf,
    );
    expect(cell.lines.map((line) => line.title)).toEqual(["One", "Two"]);
    expect(cell.hidden).toBe(1);
    expect(cell.taskCount).toBe(1);
  });

  it("shows a third title instead of +1 when no task needs the line", () => {
    const cell = monthCellSummary(
      [event("a", "One", 13), event("b", "Two", 14), event("c", "Three", 15)],
      [],
      requiredOf,
    );
    expect(cell.lines).toHaveLength(3);
    expect(cell.hidden).toBe(0);
  });

  it("folds everything past two titles once there are two or more over", () => {
    const cell = monthCellSummary(
      ["a", "b", "c", "d"].map((id, index) => event(id, id, 13 + index)),
      [],
      requiredOf,
    );
    expect(cell.lines).toHaveLength(2);
    expect(cell.hidden).toBe(2);
  });

  it("counts tasks apart from birthdays and notes an overdue one", () => {
    const cell = monthCellSummary(
      [],
      [task("t1"), task("t2", true), birthday("u1", "Ava Chen")],
      requiredOf,
    );
    expect(cell.taskCount).toBe(2);
    expect(cell.overdue).toBe(true);
    expect(cell.eventCount).toBe(0);
  });

  it("is empty for an empty day", () => {
    expect(monthCellSummary([], [], requiredOf)).toEqual({
      lines: [],
      hidden: 0,
      eventCount: 0,
      birthdayCount: 0,
      taskCount: 0,
      overdue: false,
    });
  });
});
