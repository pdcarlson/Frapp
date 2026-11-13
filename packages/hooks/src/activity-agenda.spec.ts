import { describe, expect, it } from "vitest";
import {
  activityAgenda,
  activityReview,
  activityWeekSummary,
} from "./activity-agenda";
import type { Activity } from "./activity-rows";

// Friday 13 November 2026, noon on this machine: every time below is built
// in local time, so the days fall the same in any zone.
const at = (dayOffset: number, hour = 12, minute = 0) =>
  new Date(2026, 10, 13 + dayOffset, hour, minute).toISOString();
const NOW = new Date(2026, 10, 13, 12, 0);

const task = (overrides: Record<string, unknown> = {}) => ({
  id: "task-1",
  title: "Book the venue",
  due_date: null,
  due_at: null,
  status: "TODO",
  stored_status: "TODO",
  assignee_id: "me",
  assignee_name: "Me",
  created_by: "officer",
  created_by_name: "Olive",
  point_reward: null,
  completed_at: null,
  confirmed_at: null,
  created_at: at(-10),
  ...overrides,
});
const poll = (overrides: Record<string, unknown> = {}) => ({
  message_id: "poll-1",
  channel_id: "channel-1",
  channel_name: "general",
  channel_type: "PUBLIC",
  sender_id: "officer",
  question: "Formal venue?",
  option_count: 2,
  closes_at: null,
  closed_at: null,
  is_closed: false,
  has_voted: false,
  created_at: at(-2),
  message: {},
  ...overrides,
});
const event = (overrides: Record<string, unknown> = {}) => ({
  id: "event-1",
  name: "Chapter meeting",
  location: "Great Room",
  start_time: at(2, 19),
  end_time: at(2, 20),
  attendance: "required",
  point_value: 10,
  check_in_opens_minutes: 10,
  check_in_open: false,
  checked_in: null,
  ...overrides,
});
const card = (overrides: Record<string, unknown> = {}) => ({
  kind: "signup",
  message_id: "card-1",
  channel_id: "channel-1",
  channel_name: "general",
  channel_type: "PUBLIC",
  sender_id: "olive",
  title: "Sober drivers",
  item_count: 4,
  closes_at: null,
  created_at: at(-1),
  unread: false,
  ...overrides,
});
const hours = (overrides: Record<string, unknown> = {}) => ({
  id: "hours-1",
  user_id: "member",
  member_name: "Miles",
  description: "Food bank",
  minutes: 120,
  service_date: "2026-11-10",
  created_at: at(-3),
  unread: false,
  ...overrides,
});
const count = (done: number, total: number) => ({ done, total });
const week = (overrides: Record<string, unknown> = {}) => ({
  start: at(-5, 0),
  end: at(2, 0),
  events: count(0, 0),
  tasks: count(0, 0),
  polls: count(0, 0),
  cards: count(0, 0),
  unavailable: [],
  ...overrides,
});
const activity = (overrides: Record<string, unknown> = {}) =>
  ({
    needs_you: {
      tasks: [],
      task_confirmations: [],
      hours_approvals: [],
      polls: [],
      cards: [],
    },
    coming_up: [],
    links: [],
    made_by_you: { polls: [], tasks: [], events: [] },
    needs_you_count: 0,
    unavailable: [],
    week: week(),
    ...overrides,
  }) as unknown as Activity;
const needs = (overrides: Record<string, unknown>) => ({
  tasks: [],
  task_confirmations: [],
  hours_approvals: [],
  polls: [],
  cards: [],
  ...overrides,
});

describe("activityWeekSummary (#4766)", () => {
  it("adds the kinds up into one ring, with a line per kind that has anything", () => {
    const summary = activityWeekSummary(
      activity({
        week: week({
          events: count(2, 3),
          tasks: count(1, 2),
          polls: count(1, 2),
          cards: count(1, 1),
        }),
      }),
    );
    expect(summary).toMatchObject({
      state: "open",
      done: 5,
      total: 8,
      left: 3,
      progress: 5 / 8,
      incomplete: false,
      headline: "3 left this week",
      warning: null,
      spokenLabel: "5 of 8 things done this week. 3 left this week.",
    });
    // Polls and sign-ups share a line: both are an answer the member owes.
    expect(
      summary.lines.map((line) => [line.id, line.label, line.done, line.total]),
    ).toEqual([
      ["events", "Events", 2, 3],
      ["tasks", "Tasks", 1, 2],
      ["answers", "Polls and sign-ups", 2, 3],
    ]);
    expect(summary.lines[0]!.spokenLabel).toBe("Events: 2 of 3 done");
  });

  it("says nothing is due, with no line and no zero, on an empty week", () => {
    expect(activityWeekSummary(activity())).toMatchObject({
      state: "clear",
      total: 0,
      progress: 0,
      lines: [],
      headline: "Nothing due this week",
      spokenLabel: "Nothing due this week",
    });
  });

  it("closes the ring when everything due is done", () => {
    expect(
      activityWeekSummary(
        activity({ week: week({ events: count(3, 3), tasks: count(2, 2) }) }),
      ),
    ).toMatchObject({
      state: "done",
      left: 0,
      progress: 1,
      headline: "All done this week",
    });
  });

  it("leaves out a kind the chapter has off, and one with nothing this week", () => {
    const summary = activityWeekSummary(
      activity({
        week: week({ events: count(1, 2), tasks: null, polls: null }),
      }),
    );
    expect(summary.lines.map((line) => line.id)).toEqual(["events"]);
    expect(summary).toMatchObject({ incomplete: false, total: 2 });
  });

  it("draws a failed part as a dash, says at least, and names the part", () => {
    const summary = activityWeekSummary(
      activity({
        week: week({
          events: count(2, 3),
          tasks: null,
          unavailable: ["tasks"],
        }),
      }),
    );
    expect(summary).toMatchObject({
      state: "open",
      incomplete: true,
      headline: "At least 1 left this week",
      warning: "Couldn't load tasks.",
    });
    expect(summary.lines.find((line) => line.id === "tasks")).toMatchObject({
      done: null,
      total: null,
      spokenLabel: "Tasks: couldn't load",
    });
  });

  it("never says the week is done or clear while a part is missing", () => {
    const done = activityWeekSummary(
      activity({
        week: week({
          events: count(3, 3),
          polls: null,
          cards: null,
          unavailable: ["polls", "cards"],
        }),
      }),
    );
    expect(done).toMatchObject({
      state: "open",
      headline: "Some of your week couldn't load",
      warning: "Couldn't load polls and sign-ups and forms.",
    });
    // Half of a shared line read: its numbers stand, and the line stays.
    const half = activityWeekSummary(
      activity({
        week: week({
          polls: count(1, 1),
          cards: null,
          unavailable: ["cards"],
        }),
      }),
    );
    expect(half.lines).toEqual([
      expect.objectContaining({ id: "answers", done: 1, total: 1 }),
    ]);
    expect(half.state).toBe("open");
  });

  it("has no ring to draw against an API from before the week", () => {
    const old = activity();
    delete (old as { week?: unknown }).week;
    expect(activityWeekSummary(old)).toMatchObject({
      state: "unknown",
      lines: [],
      headline: "",
    });
  });
});

describe("activityAgenda (#4766)", () => {
  const busy = () =>
    activity({
      needs_you: needs({
        tasks: [
          task({
            id: "late",
            title: "Receipts",
            status: "OVERDUE",
            due_date: "2026-11-10",
          }),
          task({ id: "today", title: "Agenda", due_at: at(0, 17) }),
          task({ id: "someday", title: "Retreat plan" }),
          task({ id: "far", title: "Banquet", due_date: "2026-12-20" }),
        ],
        polls: [poll({ message_id: "p1", closes_at: at(1, 12) })],
        cards: [card()],
      }),
      coming_up: [
        event({ id: "tomorrow", name: "Cleanup", start_time: at(1, 10) }),
        event({ id: "sunday", name: "Chapter", start_time: at(2, 19) }),
      ],
    });

  it("lists by day: Overdue, today, each day, Later, then no deadline", () => {
    const agenda = activityAgenda(busy(), "all", NOW);
    // The first thing is on the week card, not repeated in the list.
    expect(agenda.next).toMatchObject({ title: "Receipts" });
    expect(agenda.nextLabel).toBe("Next");
    expect(
      agenda.days.map((day) => [
        day.label,
        day.tone,
        day.rows.map((row) => row.title),
      ]),
    ).toEqual([
      ["Today", "plain", ["Agenda"]],
      ["Tomorrow", "plain", ["Cleanup", "Formal venue?"]],
      ["Sunday", "plain", ["Chapter"]],
      ["Later", "plain", ["Banquet"]],
      ["No deadline", "plain", ["Retreat plan", "Sober drivers"]],
    ]);
    // Every row, the card's one included, for a sheet to find its key in.
    expect(agenda.rows).toHaveLength(8);
  });

  it("says only the time under a day, and keeps the date under Later", () => {
    const agenda = activityAgenda(busy(), "all", NOW);
    const byTitle = Object.fromEntries(
      agenda.days.flatMap((day) => day.rows).map((row) => [row.title, row]),
    );
    expect(byTitle.Cleanup).toMatchObject({
      detail: "10:00 AM · Great Room",
      dateBlock: null,
    });
    expect(byTitle.Banquet!.detail).toContain("Dec 20");
    // The card's row stands alone, so it names its day.
    const next = activityAgenda(
      activity({ coming_up: [event({ start_time: at(1, 10) })] }),
      "all",
      NOW,
    ).next!;
    expect(next.detail).toBe("Tomorrow · 10:00 AM · Great Room");
    expect(next.dateBlock).toEqual({ month: "NOV", day: "14" });
  });

  it("leads with an event open for check-in, ahead of anything overdue", () => {
    const data = busy();
    data.coming_up.unshift(
      event({
        id: "live",
        name: "Walkthrough",
        start_time: at(0, 11, 50),
        check_in_open: true,
      }) as never,
    );
    const agenda = activityAgenda(data, "all", NOW);
    expect(agenda.next).toMatchObject({
      title: "Walkthrough",
      badge: { label: "Check in", variant: "warning" },
    });
    expect(agenda.nextLabel).toBe("Happening now");
    // Overdue is then the list's first run, in the warning tone, and its row
    // doesn't repeat the heading as a chip.
    expect(agenda.days[0]).toMatchObject({
      id: "overdue",
      label: "Overdue",
      tone: "warning",
      limit: null,
    });
    expect(agenda.days[0]!.rows[0]).toMatchObject({
      title: "Receipts",
      badge: null,
    });
  });

  it("drops the To do chip from the member's own tasks, and keeps what is news", () => {
    const agenda = activityAgenda(
      activity({
        needs_you: needs({
          tasks: [
            task({ id: "a", title: "Plain", due_at: at(0, 17) }),
            task({
              id: "b",
              title: "Sent back",
              due_at: at(0, 18),
              status: "IN_PROGRESS",
              stored_status: "IN_PROGRESS",
              sent_back_at: at(-1),
            }),
          ],
        }),
        coming_up: [event({ start_time: at(0, 9) })],
      }),
      "all",
      NOW,
    );
    const rows = agenda.days.flatMap((day) => day.rows);
    expect(rows.find((row) => row.title === "Plain")!.badge).toBeNull();
    expect(rows.find((row) => row.title === "Sent back")!.badge).not.toBeNull();
  });

  it("keeps Needs changes on an overdue task that was sent back", () => {
    // An officer usually sends a task back after its date: under Overdue the
    // "Overdue" chip goes, the reason it came back stays.
    const agenda = activityAgenda(
      activity({
        needs_you: needs({
          tasks: [
            task({
              id: "late",
              title: "Receipts",
              status: "OVERDUE",
              due_date: "2026-11-10",
            }),
            task({
              id: "back",
              title: "Budget",
              status: "OVERDUE",
              stored_status: "IN_PROGRESS",
              sent_back_at: at(-1),
              due_date: "2026-11-11",
            }),
          ],
        }),
      }),
      "tasks",
      NOW,
    );
    expect(agenda.days[0]).toMatchObject({ id: "overdue" });
    expect(
      agenda.days[0]!.rows.map((row) => [row.title, row.badge?.label ?? null]),
    ).toEqual([
      ["Receipts", null],
      ["Budget", "Needs changes"],
    ]);
  });

  it("heads today's rows Today, whatever an earlier item's own date says", () => {
    // A time that passed since the read, or a date the server's UTC day has
    // not called overdue yet: listed with today's, under Today.
    const agenda = activityAgenda(
      activity({
        needs_you: needs({
          tasks: [
            task({ id: "stale", title: "Stale", due_at: at(-1, 23, 50) }),
            task({ id: "today", title: "Agenda", due_at: at(0, 17) }),
          ],
        }),
      }),
      "tasks",
      NOW,
    );
    expect(
      agenda.days.map((day) => [day.label, day.rows.map((row) => row.title)]),
    ).toEqual([["Today", ["Stale", "Agenda"]]]);
  });

  it("drops a poll or sign-up whose time ran out since the read", () => {
    // #4258: the page stays open past a closing time and is not re-read.
    const agenda = activityAgenda(
      activity({
        needs_you: needs({
          polls: [
            poll({ message_id: "gone", question: "Gone", closes_at: at(0, 11) }),
            poll({ message_id: "open", question: "Open", closes_at: at(0, 13) }),
          ],
          cards: [
            card({ message_id: "c-gone", title: "Shut", closes_at: at(0, 11) }),
            card({ message_id: "c-open", title: "Rides", closes_at: at(0, 14) }),
          ],
        }),
      }),
      "all",
      NOW,
    );
    expect(agenda.rows.map((row) => row.title)).toEqual(["Open", "Rides"]);
  });

  it("leaves an event the member has checked in to off the list", () => {
    const agenda = activityAgenda(
      activity({
        coming_up: [
          event({
            id: "in",
            start_time: at(0, 11),
            check_in_open: true,
            checked_in: "PRESENT",
          }),
        ],
      }),
      "all",
      NOW,
    );
    expect(agenda.next).toBeNull();
    expect(agenda.days).toEqual([]);
  });

  it("caps a day at three rows, and never Overdue", () => {
    const agenda = activityAgenda(
      activity({
        needs_you: needs({
          tasks: [
            ...Array.from({ length: 5 }, (_, index) =>
              task({
                id: `late-${index}`,
                status: "OVERDUE",
                due_date: "2026-11-09",
              }),
            ),
            ...Array.from({ length: 6 }, (_, index) =>
              task({ id: `sat-${index}`, due_at: at(1, 9 + index) }),
            ),
          ],
        }),
      }),
      "all",
      NOW,
    );
    expect(
      agenda.days.map((day) => [day.id, day.rows.length, day.limit]),
    ).toEqual([
      // One overdue task is on the week card.
      ["overdue", 4, null],
      ["day:1", 6, 3],
    ]);
  });

  it("narrows to one kind, lifts the cap, and keeps the card's next thing", () => {
    const data = busy();
    const all = activityAgenda(data, "all", NOW);
    const events = activityAgenda(data, "events", NOW);
    expect(events.next).toEqual(all.next);
    expect(events.days.map((day) => day.rows.map((row) => row.title))).toEqual([
      ["Cleanup"],
      ["Chapter"],
    ]);
    expect(events.days.every((day) => day.limit === null)).toBe(true);
    // Under its own kind the card's row is in the list too.
    const tasks = activityAgenda(data, "tasks", NOW);
    expect(tasks.days[0]!.rows[0]!.title).toBe("Receipts");
    const answers = activityAgenda(data, "answers", NOW);
    expect(
      answers.days.flatMap((day) => day.rows).map((row) => row.kind),
    ).toEqual(["poll", "card"]);
  });

  it("names only the failed sections behind what is shown", () => {
    const data = activity({ unavailable: ["tasks", "links", "polls"] });
    expect(activityAgenda(data, "all", NOW).unavailable).toEqual([
      "tasks",
      "polls",
    ]);
    expect(activityAgenda(data, "events", NOW).unavailable).toEqual([]);
    expect(activityAgenda(data, "answers", NOW).unavailable).toEqual(["polls"]);
  });

  it("is empty with nothing to do", () => {
    expect(activityAgenda(activity(), "all", NOW)).toMatchObject({
      next: null,
      days: [],
      rows: [],
    });
  });
});

describe("activityReview (#4766)", () => {
  const officer = { canConfirmTasks: true };
  const waiting = () =>
    activity({
      needs_you: needs({
        task_confirmations: [
          task({
            id: "c1",
            title: "Chairs",
            status: "COMPLETED",
            stored_status: "COMPLETED",
            completed_at: at(-1),
          }),
          task({
            id: "c2",
            title: "Kitchen",
            status: "COMPLETED",
            stored_status: "COMPLETED",
            completed_at: at(-1),
          }),
        ],
        hours_approvals: [hours()],
      }),
    });

  it("is one card: the count, what it is made of, and the rows", () => {
    const review = activityReview(waiting(), officer, NOW)!;
    expect(review).toMatchObject({
      count: "3",
      detail: "2 tasks · 1 hours entry",
      unavailable: [],
    });
    expect(review.rows.map((row) => [row.kind, row.badge?.label])).toEqual([
      ["task", "Confirm"],
      ["task", "Confirm"],
      ["hours", "Approve"],
    ]);
    // The key the Needs you group gave it, so `?review=` finds the same row.
    expect(review.rows[0]!.key).toBe("needs-confirm:task:c1");
  });

  it("is nothing with nothing waiting, for a member and for an officer", () => {
    expect(
      activityReview(
        activity(),
        { canConfirmTasks: false },
        NOW,
      ),
    ).toBeNull();
    expect(activityReview(activity(), officer, NOW)).toBeNull();
  });

  it("shows what the read served before the permissions are known", () => {
    // The server lists these only for a member who may act on them.
    expect(
      activityReview(
        waiting(),
        { canConfirmTasks: false },
        NOW,
      ),
    ).toMatchObject({ count: "3" });
  });

  it("says a list reached the read's cap", () => {
    const review = activityReview(
      activity({
        needs_you: needs({
          task_confirmations: Array.from({ length: 25 }, (_, index) =>
            task({
              id: `c-${index}`,
              status: "COMPLETED",
              stored_status: "COMPLETED",
            }),
          ),
        }),
      }),
      officer,
      NOW,
    )!;
    expect(review).toMatchObject({ count: "25+", detail: "25+ tasks" });
  });

  it("stays, with a warning to draw, when a part behind it failed", () => {
    const review = activityReview(
      activity({ unavailable: ["hours_approvals", "polls"] }),
      officer,
      NOW,
    )!;
    expect(review).toMatchObject({
      rows: [],
      unavailable: ["hours_approvals"],
    });
  });

  it("names a failed hours queue before the permissions are known", () => {
    // The read tries that queue only for a member who approves hours, so its
    // failure is theirs whatever the phone knows of their role yet. An empty
    // queue and a failed one must not look the same.
    expect(
      activityReview(
        activity({ unavailable: ["hours_approvals"] }),
        { canConfirmTasks: false },
        NOW,
      ),
    ).toMatchObject({ rows: [], unavailable: ["hours_approvals"] });
  });

  it("leaves a failed tasks read to To do for a member who confirms nothing", () => {
    expect(
      activityReview(
        activity({ unavailable: ["tasks"] }),
        { canConfirmTasks: false },
        NOW,
      ),
    ).toBeNull();
    expect(
      activityReview(activity({ unavailable: ["tasks"] }), officer, NOW),
    ).toMatchObject({ unavailable: ["tasks"] });
  });
});
