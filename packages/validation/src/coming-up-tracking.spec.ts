import { describe, expect, it } from "vitest";
import {
  comingUpChips,
  comingUpCopyText,
  comingUpEventTimes,
  comingUpMenu,
  comingUpTracking,
  localDayOf,
} from "./coming-up-tracking";

const noon = (day: string) => new Date(`${day}T12:00:00`).toISOString();

const task = (
  over: Partial<{
    id: string;
    title: string;
    due_date: string;
    assignee_id: string;
    meeting_id: string | null;
    group_id: string | null;
    status: string;
  }>,
) => ({
  id: "t",
  title: "Something else",
  due_date: "2026-11-21",
  assignee_id: "u1",
  meeting_id: null,
  group_id: null,
  status: "TODO",
  ...over,
});

describe("comingUpTracking", () => {
  const dates = [
    { date: "2026-12-06", text: "Winter formal at the Hilton" },
    { date: "2026-11-21", text: "Dues due to the treasurer" },
  ];

  it("finds the event on that day whose name reads like the date", () => {
    const [formal, dues] = comingUpTracking(dates, {
      meetingId: "m1",
      events: [
        { id: "e0", name: "Chapter Meeting", start_time: noon("2026-12-06") },
        { id: "e1", name: "Winter Formal", start_time: noon("2026-12-06") },
        { id: "e2", name: "Winter Formal", start_time: noon("2026-12-07") },
      ],
      tasks: [],
    });
    expect(formal.event?.id).toBe("e1");
    expect(dues.event).toBeNull();
  });

  it("takes a task made from these minutes for the day, or one that reads alike", () => {
    const [, dues] = comingUpTracking(dates, {
      meetingId: "m1",
      events: [],
      tasks: [
        task({ id: "a", title: "Collect dues", meeting_id: "m1" }),
        task({ id: "b", title: "Dues due to the treasurer" }),
        task({ id: "c", title: "Book the band" }),
        task({
          id: "d",
          title: "Collect dues",
          meeting_id: "m1",
          due_date: "2026-11-22",
        }),
      ],
    });
    expect(dues.tasks.map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("counts a task for everyone once", () => {
    const [, dues] = comingUpTracking(dates, {
      meetingId: "m1",
      events: [],
      tasks: [
        task({ id: "a", meeting_id: "m1", group_id: "g" }),
        task({ id: "b", meeting_id: "m1", group_id: "g", assignee_id: "u2" }),
      ],
    });
    expect(dues.tasks).toHaveLength(1);
  });
});

describe("localDayOf", () => {
  it("reads the viewer's day", () => {
    expect(localDayOf(noon("2026-12-06"))).toBe("2026-12-06");
    expect(localDayOf("nope")).toBe("");
  });
});

describe("comingUpCopyText", () => {
  it("writes the day out before the words", () => {
    expect(
      comingUpCopyText(
        { date: "2026-12-02", text: "Philanthropy committee reports back" },
        new Date(2026, 10, 19),
      ),
    ).toBe("Wednesday, December 2: Philanthropy committee reports back");
  });
});

describe("comingUpChips", () => {
  const event = { id: "e", name: "Formal", start_time: noon("2026-12-06") };
  const made = {
    id: "t",
    title: "Dues",
    due_date: "2026-12-04",
    assignee_id: "u2",
  };
  const nameFor = (id: string) => (id === "u2" ? "Jake" : null);

  it("says the calendar, then whose task it is", () => {
    expect(
      comingUpChips({ event, tasks: [made] }, nameFor).map((c) => c.label),
    ).toEqual(["On the calendar", "Task · Jake"]);
  });

  it("names the viewer You, counts several, and says nothing of nothing", () => {
    expect(
      comingUpChips({ event: null, tasks: [made] }, nameFor, "u2"),
    ).toEqual([{ key: "task", label: "Task · You" }]);
    expect(
      comingUpChips(
        { event: null, tasks: [made, { ...made, id: "t2" }] },
        nameFor,
      ),
    ).toEqual([{ key: "task", label: "2 tasks" }]);
    expect(comingUpChips({ event: null, tasks: [] }, nameFor)).toEqual([]);
  });
});

describe("comingUpMenu", () => {
  const labels = (input: Parameters<typeof comingUpMenu>[0]) =>
    comingUpMenu(input).map((item) => item.label);

  it("offers an officer the calendar, a task and the copy, in that order", () => {
    expect(
      labels({ hasEvent: false, canCreateEvents: true, canManageTasks: true }),
    ).toEqual(["Add to calendar", "Make a task", "Copy date"]);
    expect(
      labels({ hasEvent: true, canCreateEvents: true, canManageTasks: true }),
    ).toEqual(["Open the event", "Make a task", "Copy date"]);
  });

  it("leaves a member the event, when there is one, and the copy", () => {
    expect(
      labels({
        hasEvent: false,
        canCreateEvents: false,
        canManageTasks: false,
      }),
    ).toEqual(["Copy date"]);
    expect(
      labels({ hasEvent: true, canCreateEvents: false, canManageTasks: false }),
    ).toEqual(["Open the event", "Copy date"]);
  });
});

describe("comingUpEventTimes", () => {
  it("starts at 7 PM that day, for an hour", () => {
    const times = comingUpEventTimes("2026-12-06")!;
    expect(times.start).toEqual(new Date(2026, 11, 6, 19));
    expect(times.end).toEqual(new Date(2026, 11, 6, 20));
    expect(comingUpEventTimes("soon")).toBeNull();
  });
});
