import { describe, expect, it } from "vitest";
import {
  ALL_CALENDAR_LAYERS,
  calendarKindOf,
  calendarTaskAccessibleLabel,
  calendarTasksByDay,
  parseHiddenCalendarKinds,
  selectCalendarTasks,
  serializeHiddenCalendarKinds,
  type CalendarAssignedTask,
  type CalendarTask,
  type CalendarKind,
} from "./calendar-tasks";

const ME = "user-me";

function task(overrides: Record<string, unknown> = {}) {
  return {
    id: `t-${Math.random().toString(36).slice(2)}`,
    title: "Dues form",
    assignee_id: ME,
    created_by: "officer",
    due_date: "2026-11-12",
    status: "TODO",
    stored_status: "TODO",
    points_awarded: false,
    confirmed_at: null,
    ...overrides,
  };
}

describe("selectCalendarTasks", () => {
  it("keeps the viewer's own tasks on their due day with the shared words", () => {
    const items = selectCalendarTasks(
      [
        task({ id: "a" }),
        task({ id: "b", status: "OVERDUE", due_date: "2026-11-01" }),
        task({ id: "c", status: "COMPLETED" }),
        task({ id: "d", status: "COMPLETED", points_awarded: true }),
      ],
      ME,
    );
    expect(
      items.map((item) => [
        item.kind,
        item.day,
        item.state,
        item.kind === "mine" ? item.label : "",
      ]),
    ).toEqual([
      ["mine", "2026-11-12", "open", "To do"],
      ["mine", "2026-11-01", "overdue", "Overdue"],
      ["mine", "2026-11-12", "waiting", "Waiting on an officer"],
      ["mine", "2026-11-12", "confirmed", "Confirmed"],
    ]);
  });

  it("folds one task handed to many members into one item with progress", () => {
    const rows = [
      ...Array.from({ length: 9 }, (_, index) =>
        task({ id: `open-${index}`, assignee_id: `m${index}`, created_by: ME }),
      ),
      task({ id: "w", assignee_id: "m9", created_by: ME, status: "COMPLETED" }),
      task({
        id: "c",
        assignee_id: "m10",
        created_by: ME,
        status: "COMPLETED",
        confirmed_at: "2026-11-11T10:00:00Z",
      }),
      task({ id: "o", assignee_id: "m11", created_by: ME, status: "OVERDUE" }),
    ];
    const items = selectCalendarTasks(rows, ME);
    expect(items).toHaveLength(1);
    const group = items[0] as CalendarAssignedTask;
    expect(group.kind).toBe("assigned");
    expect(group.assignees).toHaveLength(12);
    expect(group.doneCount).toBe(2);
    expect(group.progress).toBe("2 of 12 done");
    // The group reads as its most urgent assignee.
    expect(group.state).toBe("overdue");
    expect(group.assignees[0]!.state).toBe("overdue");
  });

  it("names the one assignee's status when a task went to one member", () => {
    const [group] = selectCalendarTasks(
      [task({ assignee_id: "m1", created_by: ME, status: "COMPLETED" })],
      ME,
    ) as CalendarAssignedTask[];
    expect(group!.progress).toBe("Waiting on an officer");
    expect(group!.state).toBe("waiting");
  });

  it("keeps the same title on different days apart", () => {
    const items = selectCalendarTasks(
      [
        task({ assignee_id: "m1", created_by: ME }),
        task({ assignee_id: "m2", created_by: ME, due_date: "2026-11-19" }),
      ],
      ME,
    );
    expect(items.map((item) => item.day)).toEqual(["2026-11-12", "2026-11-19"]);
  });

  it("shows a self-assigned task once, as the viewer's own", () => {
    const items = selectCalendarTasks([task({ created_by: ME })], ME);
    expect(items.map((item) => item.kind)).toEqual(["mine"]);
  });

  it("leaves out other people's tasks an officer can see but did not assign", () => {
    expect(
      selectCalendarTasks([task({ assignee_id: "m1", created_by: "x" })], ME),
    ).toEqual([]);
  });

  it("drops rows it can't draw and waits for the viewer", () => {
    expect(selectCalendarTasks([task()], null)).toEqual([]);
    expect(selectCalendarTasks(undefined, ME)).toEqual([]);
    expect(
      selectCalendarTasks(
        [task({ due_date: null }), task({ status: "WEIRD" }), { id: "x" }],
        ME,
      ),
    ).toEqual([]);
  });
});

describe("calendarTasksByDay", () => {
  const items = selectCalendarTasks(
    [
      task({ id: "1", title: "Zeta", status: "COMPLETED" }),
      task({ id: "2", title: "Alpha" }),
      task({ id: "3", title: "Beta", status: "OVERDUE" }),
      task({ id: "4", title: "Aaa", assignee_id: "m1", created_by: ME }),
    ],
    ME,
  );

  it("lists own before assigned, most urgent first", () => {
    const day = calendarTasksByDay(items, ALL_CALENDAR_LAYERS).get(
      "2026-11-12",
    );
    expect(day?.map((item) => item.title)).toEqual([
      "Beta",
      "Alpha",
      "Zeta",
      "Aaa",
    ]);
  });

  it("hides a layer that is switched off", () => {
    const day = calendarTasksByDay(items, new Set(["events", "assigned"])).get(
      "2026-11-12",
    );
    expect(day?.map((item) => item.kind)).toEqual(["assigned"]);
  });
});

describe("colour key kinds (#5560)", () => {
  it("files own and assigned tasks as Tasks, and birthdays as Birthdays", () => {
    const [mine, assigned] = selectCalendarTasks(
      [task(), task({ assignee_id: "m1", created_by: ME })],
      ME,
    );
    expect(calendarKindOf(mine!)).toBe("tasks");
    expect(calendarKindOf(assigned!)).toBe("tasks");
    expect(
      calendarKindOf({
        kind: "birthdays",
        key: "b",
        title: "Dana",
        userId: "u",
        day: "2026-11-12",
      }),
    ).toBe("birthdays");
  });

  it("stores what's hidden and reads it back, dropping junk", () => {
    const hidden = new Set<CalendarKind>(["birthdays", "tasks"]);
    const raw = serializeHiddenCalendarKinds(hidden);
    expect(JSON.parse(raw)).toEqual({ hidden: ["tasks", "birthdays"] });
    expect(parseHiddenCalendarKinds(raw)).toEqual(hidden);
    expect(parseHiddenCalendarKinds('{"hidden":["mine","events"]}')).toEqual(
      new Set(["events"]),
    );
    expect(parseHiddenCalendarKinds('["events"]')).toBeNull();
    expect(parseHiddenCalendarKinds("{")).toBeNull();
    expect(parseHiddenCalendarKinds(null)).toBeNull();
  });
});

describe("calendarTaskAccessibleLabel", () => {
  it("says whose task it is and where it stands", () => {
    const [mine, assigned] = selectCalendarTasks(
      [
        task({ status: "OVERDUE" }),
        task({ assignee_id: "m1", created_by: ME }),
        task({ assignee_id: "m2", created_by: ME, status: "COMPLETED" }),
      ],
      ME,
    );
    expect(calendarTaskAccessibleLabel(mine!)).toBe(
      "Dues form, your task, overdue",
    );
    expect(calendarTaskAccessibleLabel(assigned!)).toBe(
      "Dues form, assigned by you, 1 of 2 done",
    );
  });
});

describe("tasks due at a time (#5116)", () => {
  // A local wall-clock moment, as the API returns `due_at`.
  const at = (day: number, hour: number, minute = 0) =>
    new Date(2026, 10, day, hour, minute).toISOString();

  it("says the time, files the task on that moment's local day, and keeps untimed ones as they were", () => {
    const [timed, untimed] = selectCalendarTasks(
      [
        task({ id: "a", due_date: "2026-11-12", due_at: at(12, 17) }),
        task({ id: "b", due_date: "2026-11-12", due_at: null }),
      ],
      ME,
    );
    expect(timed).toMatchObject({
      day: "2026-11-12",
      dueMinute: 17 * 60,
      timeLabel: "5 PM",
      dueAt: at(12, 17),
    });
    expect(untimed).toMatchObject({
      day: "2026-11-12",
      dueAt: null,
      dueMinute: null,
      timeLabel: null,
    });
  });

  it("files a task by its due moment's local day, not the day it was written with", () => {
    // Written as Nov 12 on a device a zone away; here the moment is Nov 13.
    const [item] = selectCalendarTasks(
      [task({ due_date: "2026-11-12", due_at: at(13, 0, 30) })],
      ME,
    );
    expect(item).toMatchObject({ day: "2026-11-13", dueMinute: 30 });
  });

  it("falls back to the due day when the time can't be read", () => {
    const [item] = selectCalendarTasks(
      [task({ due_date: "2026-11-12", due_at: "not a time" })],
      ME,
    );
    expect(item).toMatchObject({ day: "2026-11-12", timeLabel: null });
  });

  it("keeps an officer's same task at two times as two items", () => {
    const items = selectCalendarTasks(
      [
        task({
          id: "1",
          assignee_id: "m1",
          created_by: ME,
          due_at: at(12, 9, 30),
        }),
        task({
          id: "2",
          assignee_id: "m2",
          created_by: ME,
          due_at: at(12, 9, 30),
        }),
        task({
          id: "3",
          assignee_id: "m3",
          created_by: ME,
          due_at: at(12, 17),
        }),
        task({ id: "4", assignee_id: "m4", created_by: ME }),
      ],
      ME,
    );
    expect(
      items.map((item) =>
        item.kind === "assigned"
          ? [item.timeLabel, item.assignees.length]
          : null,
      ),
    ).toEqual([
      ["9:30 AM", 2],
      ["5 PM", 1],
      [null, 1],
    ]);
  });

  it("lists a day's timed tasks first by time, then the untimed ones, as Tasks does", () => {
    const items = selectCalendarTasks(
      [
        task({ id: "1", title: "Late", due_at: at(12, 20) }),
        task({ id: "2", title: "Anytime", status: "COMPLETED" }),
        task({
          id: "3",
          title: "Early, assigned",
          assignee_id: "m1",
          created_by: ME,
          due_at: at(12, 8),
        }),
      ],
      ME,
    );
    const day = calendarTasksByDay(items, ALL_CALENDAR_LAYERS).get(
      "2026-11-12",
    );
    expect(day?.map((item) => item.title)).toEqual([
      "Early, assigned",
      "Late",
      "Anytime",
    ]);
  });

  it("says the time to a screen reader", () => {
    const [item] = selectCalendarTasks([task({ due_at: at(12, 17) })], ME);
    expect(calendarTaskAccessibleLabel(item as CalendarTask)).toBe(
      "Dues form, due 5 PM, your task, to do",
    );
  });
});
