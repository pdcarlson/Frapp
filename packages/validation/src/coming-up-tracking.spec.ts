import { describe, expect, it } from "vitest";
import {
  comingUpChips,
  comingUpCopyText,
  comingUpEventTimes,
  comingUpMenu,
  comingUpPostReview,
  COMING_UP_REVIEW_COPY,
  comingUpIsAhead,
  comingUpReminderFor,
  comingUpReminderTime,
  comingUpReminderWhen,
  comingUpTracking,
} from "./coming-up-tracking";

const noon = (day: string) => new Date(`${day}T12:00:00`).toISOString();

const task = (
  over: Partial<{
    id: string;
    title: string;
    due_date: string;
    assignee_id: string;
    group_id: string | null;
  }>,
) => ({
  id: "t",
  title: "Something else",
  due_date: "2026-11-21",
  assignee_id: "u1",
  group_id: null,
  ...over,
});

describe("comingUpTracking", () => {
  const dates = [
    { date: "2026-12-06", text: "Winter formal at the Hilton" },
    { date: "2026-11-21", text: "Dues to the treasurer" },
  ];

  it("finds the event on that day that shares the date's words", () => {
    const [formal, dues] = comingUpTracking(dates, {
      events: [
        { id: "e0", name: "Chapter Meeting", start_time: noon("2026-12-06") },
        { id: "e1", name: "Formal", start_time: noon("2026-12-06") },
        { id: "e2", name: "Winter Formal", start_time: noon("2026-12-07") },
        { id: "e3", name: "Treasurer office hours", start_time: "nope" },
      ],
      tasks: [],
    });
    expect(formal!.event?.id).toBe("e1");
    expect(dues!.event).toBeNull();
  });

  it("takes a task due that day about the same thing, however it is worded", () => {
    const [, dues] = comingUpTracking(dates, {
      events: [],
      tasks: [
        task({ id: "a", title: "Collect dues from brothers" }),
        task({ id: "b", title: "Order pledge pins" }),
        task({ id: "c", title: "Dues", due_date: "2026-11-22" }),
      ],
    });
    expect(dues!.tasks.map((t) => t.id)).toEqual(["a"]);
  });

  it("counts a task for several people once, with how many it went to", () => {
    const [, dues] = comingUpTracking(dates, {
      events: [],
      tasks: [
        task({ id: "a", title: "Pay dues", group_id: "g" }),
        task({ id: "b", title: "Pay dues", group_id: "g", assignee_id: "u2" }),
        task({ id: "c", title: "Pay dues", group_id: "g", assignee_id: "u3" }),
      ],
    });
    expect(dues!.tasks).toHaveLength(1);
    expect(dues!.tasks[0]!.people).toBe(3);
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
    people: 1,
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
    expect(
      comingUpChips({ event: null, tasks: [{ ...made, people: 12 }] }, nameFor),
    ).toEqual([{ key: "task", label: "Task · 12 people" }]);
  });

  it("ends with the viewer's own reminder", () => {
    const at = new Date(2026, 11, 3, 18);
    expect(
      comingUpChips({ event, tasks: [] }, nameFor, null, {
        remind_at: at.toISOString(),
      }),
    ).toEqual([
      { key: "event", label: "On the calendar" },
      { key: "reminder", label: "Reminder · December 3, 6 PM" },
    ]);
  });
});

describe("comingUpMenu", () => {
  const labels = (over: Partial<Parameters<typeof comingUpMenu>[0]>) =>
    comingUpMenu({
      hasEvent: false,
      upcoming: true,
      canCreateEvents: false,
      canManageTasks: false,
      ...over,
    }).map((item) => item.label);
  const officer = { canCreateEvents: true, canManageTasks: true };

  it("offers an officer the calendar, a task and the copy, in that order", () => {
    expect(labels(officer)).toEqual([
      "Add to calendar",
      "Make a task",
      "Copy date",
    ]);
    expect(labels({ ...officer, hasEvent: true })).toEqual([
      "Open the event",
      "Make a task",
      "Copy date",
    ]);
  });

  it("leaves a member the event, when there is one, and the copy", () => {
    expect(labels({})).toEqual(["Copy date"]);
    expect(labels({ hasEvent: true })).toEqual(["Open the event", "Copy date"]);
  });

  it("offers nothing to make for a day already gone", () => {
    expect(labels({ ...officer, upcoming: false })).toEqual(["Copy date"]);
  });
});

describe("comingUpEventTimes", () => {
  const now = new Date(2026, 10, 19, 15, 7);

  it("starts at 7 PM that day, for an hour", () => {
    const times = comingUpEventTimes("2026-12-06", now)!;
    expect(times.start).toEqual(new Date(2026, 11, 6, 19));
    expect(times.end).toEqual(new Date(2026, 11, 6, 20));
  });

  it("starts at the next quarter hour today once 7 PM has gone, and not at all for a past day", () => {
    const late = new Date(2026, 10, 19, 20, 7);
    expect(comingUpEventTimes("2026-11-19", late)!.start).toEqual(
      new Date(2026, 10, 19, 20, 15),
    );
    expect(comingUpEventTimes("2026-11-18", now)).toBeNull();
    expect(comingUpEventTimes("soon", now)).toBeNull();
  });
});

describe("comingUpIsAhead", () => {
  it("counts today as ahead", () => {
    const now = new Date(2026, 10, 19, 23, 30);
    expect(comingUpIsAhead("2026-11-19", now)).toBe(true);
    expect(comingUpIsAhead("2026-11-18", now)).toBe(false);
  });
});

describe("Remind me", () => {
  it("is offered to every reader first, and becomes Cancel reminder once set", () => {
    const base = {
      hasEvent: false,
      upcoming: true,
      canCreateEvents: false,
      canManageTasks: false,
    };
    const labels = (over: Partial<Parameters<typeof comingUpMenu>[0]>) =>
      comingUpMenu({ ...base, ...over }).map((item) => item.label);
    expect(labels({ canRemind: true })).toEqual(["Remind me", "Copy date"]);
    expect(labels({ canRemind: true, hasReminder: true })).toEqual([
      "Cancel reminder",
      "Copy date",
    ]);
    expect(labels({ canRemind: false })).toEqual(["Copy date"]);
  });

  it("reminds at 6 PM the evening before, else 9 AM on the day, else not at all", () => {
    expect(
      comingUpReminderTime("2026-12-04", new Date(2026, 10, 20, 12)),
    ).toEqual(new Date(2026, 11, 3, 18));
    expect(
      comingUpReminderTime("2026-12-04", new Date(2026, 11, 3, 19)),
    ).toEqual(new Date(2026, 11, 4, 9));
    expect(
      comingUpReminderTime("2026-12-04", new Date(2026, 11, 4, 10)),
    ).toBeNull();
    expect(comingUpReminderTime("soon", new Date(2026, 10, 20))).toBeNull();
    // A day that doesn't exist, or one past what the API takes.
    expect(
      comingUpReminderTime("2027-02-30", new Date(2026, 10, 20)),
    ).toBeNull();
    expect(
      comingUpReminderTime("2028-01-15", new Date(2026, 10, 20)),
    ).toBeNull();
  });

  it("writes when it comes out, minutes only when there are some", () => {
    expect(comingUpReminderWhen(new Date(2026, 11, 3, 18))).toBe(
      "December 3, 6 PM",
    );
    expect(comingUpReminderWhen(new Date(2026, 11, 3, 18, 30))).toBe(
      "December 3, 6:30 PM",
    );
  });

  it("finds the viewer's reminder by the date's day and words", () => {
    const reminders = [
      { id: "r1", date: "2026-12-04", text: "Winter formal" },
      { id: "r2", date: "2026-12-06", text: "Winter formal" },
    ];
    expect(
      comingUpReminderFor(reminders, {
        date: "2026-12-06",
        text: "Winter formal ",
      })?.id,
    ).toBe("r2");
    expect(
      comingUpReminderFor(reminders, { date: "2026-12-04", text: "Formal" }),
    ).toBeNull();
  });
});

describe("comingUpPostReview", () => {
  const NOW = new Date("2026-11-20T15:00:00");
  const dates = [
    { date: "2026-11-21", text: "Dues due to the treasurer" },
    { date: "2026-12-02", text: "Philanthropy committee reports back" },
    { date: "2026-12-06", text: "Winter formal at the Hilton" },
    { date: "2026-11-01", text: "Homecoming cleanup" },
    { date: "2026-11-25", text: "Composite photo forms" },
  ];
  const untracked = { event: null, tasks: [] };
  const tracking = [
    untracked,
    untracked,
    {
      event: {
        id: "e1",
        name: "Winter Formal",
        start_time: noon("2026-12-06"),
      },
      tasks: [],
    },
    untracked,
    { event: null, tasks: [{ ...task({ id: "t9" }), people: 1 }] },
  ];
  const members = [
    { user_id: "marcus", display_name: "Marcus Hale" },
    { user_id: "dana", display_name: "Dana Ruiz" },
  ];
  const base = {
    dates,
    tracking,
    actionItems: [] as {
      text: string;
      owner_user_id: string | null;
      due_date: string | null;
    }[],
    suggestions: [],
    members,
    now: NOW,
  };

  it("offers a task per untracked date still ahead, and shows the calendar's", () => {
    const rows = comingUpPostReview(base);
    expect(rows.map((row) => [row.index, row.kind, row.checked])).toEqual([
      [0, "task", true],
      [1, "task", true],
      [2, "calendar", false],
    ]);
    expect(rows[0]).toMatchObject({
      title: "Dues due to the treasurer",
      assigneeId: null,
      suggestion: null,
    });
    expect(rows[2]?.title).toBe("Winter Formal");
  });

  it("names the owner the action items give, before a name in the date", () => {
    const rows = comingUpPostReview({
      ...base,
      dates: [{ date: "2026-11-21", text: "Dana: dues due to the treasurer" }],
      tracking: [untracked],
      actionItems: [
        {
          text: "Collect dues for the treasurer",
          owner_user_id: "marcus",
          due_date: null,
        },
      ],
    });
    expect(rows[0]).toMatchObject({ assigneeId: "marcus", checked: true });
  });

  it("needs two words in common with an undated action item, one with a dated", () => {
    const one = {
      ...base,
      dates: [{ date: "2026-11-21", text: "Formal dues" }],
      tracking: [untracked],
    };
    expect(
      comingUpPostReview({
        ...one,
        actionItems: [
          { text: "Pay chapter dues", owner_user_id: "marcus", due_date: null },
        ],
      })[0]?.assigneeId,
    ).toBeNull();
    expect(
      comingUpPostReview({
        ...one,
        actionItems: [
          {
            text: "Pay chapter dues",
            owner_user_id: "marcus",
            due_date: "2026-11-21",
          },
        ],
      })[0]?.assigneeId,
    ).toBe("marcus");
  });

  it("gives the poster a line whose named owner isn't on the roster", () => {
    const rows = comingUpPostReview({
      ...base,
      dates: [{ date: "2026-11-21", text: "Dues due to the treasurer" }],
      tracking: [untracked],
      actionItems: [
        {
          text: "Collect dues for the treasurer",
          owner_user_id: "gone",
          due_date: null,
        },
      ],
    });
    expect(rows[0]).toMatchObject({ assigneeId: null, checked: true });
  });

  it("guesses from the date's own words when no action item says", () => {
    const rows = comingUpPostReview({
      ...base,
      dates: [{ date: "2026-11-21", text: "Marcus Hale hands in dues" }],
      tracking: [untracked],
      actionItems: [
        // Due another day: not this date's.
        { text: "Collect dues", owner_user_id: "dana", due_date: "2026-11-30" },
      ],
    });
    expect(rows[0]).toMatchObject({ assigneeId: "marcus", checked: true });
  });

  it("accepts the suggested task the action item became, once", () => {
    const suggestion = {
      id: "s1",
      quote: "Marcus collects dues for the treasurer",
      task: {
        title: "Collect dues for the treasurer",
        assignee_id: "marcus",
        due_date: null,
      },
    };
    const rows = comingUpPostReview({
      ...base,
      dates: [
        { date: "2026-11-21", text: "Dues due to the treasurer" },
        { date: "2026-11-22", text: "Treasurer chases late dues" },
      ],
      tracking: [untracked, untracked],
      actionItems: [
        {
          text: "Marcus collects dues for the treasurer ",
          owner_user_id: "marcus",
          due_date: null,
        },
      ],
      suggestions: [suggestion],
    });
    expect(rows[0]).toMatchObject({
      title: "Collect dues for the treasurer",
      description: null,
      assigneeId: "marcus",
      suggestion: { id: "s1", due_date: null, assignee_id: "marcus" },
      checked: true,
    });
    expect(rows[1]).toMatchObject({ suggestion: null });
  });

  it("leaves a date whose suggestion is for a group to Suggested tasks", () => {
    const rows = comingUpPostReview({
      ...base,
      dates: [{ date: "2026-11-21", text: "Dues due" }],
      tracking: [untracked],
      actionItems: [
        {
          text: "Everyone pays dues",
          owner_user_id: null,
          due_date: "2026-11-21",
        },
      ],
      suggestions: [
        {
          id: "s2",
          quote: "Everyone pays dues",
          task: {
            title: "Pay dues",
            assignee_id: null,
            audience: "everyone",
            due_date: null,
          },
        },
      ],
    });
    expect(rows).toEqual([]);
  });

  it("cuts a long date to a task title, keeping the whole line", () => {
    const long = `Formal ${"ticket money ".repeat(30)}`.trim();
    const [row] = comingUpPostReview({
      ...base,
      dates: [{ date: "2026-11-21", text: long }],
      tracking: [untracked],
    });
    expect(row?.title.length).toBeLessThanOrEqual(255);
    expect(row?.title.endsWith("…")).toBe(true);
    expect(row?.description).toBe(long);
  });

  it("words the lines", () => {
    expect(COMING_UP_REVIEW_COPY.taskFor("Marcus Hale")).toBe(
      "Task for Marcus Hale",
    );
    expect(COMING_UP_REVIEW_COPY.taskFor(null)).toBe("Task for you");
    expect(COMING_UP_REVIEW_COPY.track(2)).toBe("Track 2");
    expect(COMING_UP_REVIEW_COPY.made(1)).toBe("Made 1 task");
  });
});
