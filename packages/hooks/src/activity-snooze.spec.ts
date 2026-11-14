import { describe, expect, it } from "vitest";
import type { Activity } from "./activity-rows";
import {
  activityAwake,
  activitySnoozeOptions,
  activitySnoozedRows,
  setActivitySnooze,
} from "./activity-snooze";

const NOW = new Date(2026, 10, 18, 10, 0); // Wednesday 10:00 local
const later = (hours: number) =>
  new Date(NOW.getTime() + hours * 3_600_000).toISOString();

const task = (id: string, snoozed_until: string | null = null) => ({
  id,
  title: `Task ${id}`,
  due_date: "2099-01-01",
  status: "TODO",
  stored_status: "TODO",
  assignee_id: "me",
  assignee_name: "Me",
  created_by: "officer",
  created_by_name: "Olive",
  point_reward: null,
  completed_at: null,
  confirmed_at: null,
  created_at: "2026-11-01T00:00:00.000Z",
  unread: true,
  snoozed_until,
});

const link = (id: string, snoozed_until: string | null = null) => ({
  id,
  url: "https://forms.gle/abc",
  host: "forms.gle",
  title: "Rush shifts",
  message_id: `message-${id}`,
  thread_root_id: null,
  channel_id: "channel-1",
  channel_name: "rush",
  channel_type: "PUBLIC",
  posted_by: "olive",
  posted_by_name: "Olive",
  posted_at: "2026-11-10T15:00:00.000Z",
  unread: false,
  snoozed_until,
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
    ...overrides,
  }) as unknown as Activity;

describe("activityAwake", () => {
  it("drops a row while its snooze holds and keeps it once it has passed", () => {
    const data = activity({
      needs_you: {
        tasks: [task("a", later(2)), task("b"), task("c", later(-1))],
        task_confirmations: [],
        hours_approvals: [],
        polls: [],
        cards: [],
      },
      links: [link("l", later(5))],
    });

    const awake = activityAwake(data, NOW);
    expect(awake.needs_you.tasks.map((row) => row.id)).toEqual(["b", "c"]);
    expect(awake.links).toEqual([]);

    // Three hours on, the task is back; the link still sleeps.
    const after = activityAwake(data, new Date(NOW.getTime() + 3 * 3_600_000));
    expect(after.needs_you.tasks.map((row) => row.id)).toEqual(["a", "b", "c"]);
    expect(after.links).toEqual([]);
  });

  it("keeps the same lists when nothing is snoozed", () => {
    const data = activity({ links: [link("l")] });
    expect(activityAwake(data, NOW).links).toBe(data.links);
  });
});

describe("setActivitySnooze", () => {
  it("sets and clears the time on the named item only", () => {
    const data = activity({
      needs_you: {
        tasks: [task("a"), task("b")],
        task_confirmations: [task("a")],
        hours_approvals: [],
        polls: [],
        cards: [],
      },
    });

    const snoozed = setActivitySnooze(
      data,
      { kind: "task", item_id: "a" },
      later(2),
    );
    expect(snoozed.needs_you.tasks.map((row) => row.snoozed_until)).toEqual([
      later(2),
      null,
    ]);
    // A task in two lists is the same item.
    expect(snoozed.needs_you.task_confirmations[0]?.snoozed_until).toBe(
      later(2),
    );

    const woken = setActivitySnooze(
      snoozed,
      { kind: "task", item_id: "a" },
      null,
    );
    expect(woken.needs_you.tasks[0]?.snoozed_until).toBeNull();
  });
});

describe("activitySnoozedRows", () => {
  it("lists what sleeps, soonest back first, saying when, with no dot", () => {
    const data = activity({
      needs_you: {
        tasks: [task("a", later(30)), task("b")],
        task_confirmations: [],
        hours_approvals: [],
        polls: [],
        cards: [],
      },
      links: [link("l", later(2))],
    });

    const rows = activitySnoozedRows(data, NOW);
    expect(rows.map((row) => row.kind)).toEqual(["link", "task"]);
    expect(rows.map((row) => row.detail)).toEqual([
      "Back Today · 12:00 PM",
      "Back Tomorrow · 4:00 PM",
    ]);
    expect(rows.every((row) => !row.unread && row.badge === null)).toBe(true);
  });
});

describe("activitySnoozeOptions", () => {
  const ids = (now: Date) => activitySnoozeOptions(now).map((o) => o.id);

  it("offers Gmail's set midweek", () => {
    const options = activitySnoozeOptions(NOW);
    expect(options.map((o) => o.id)).toEqual([
      "later-today",
      "tomorrow",
      "weekend",
      "next-week",
    ]);
    expect(options.map((o) => o.until.toString())).toEqual([
      new Date(2026, 10, 18, 18).toString(),
      new Date(2026, 10, 19, 8).toString(),
      new Date(2026, 10, 21, 8).toString(),
      new Date(2026, 10, 23, 8).toString(),
    ]);
  });

  it("drops Later today within an hour of the evening, and the weekend from Friday", () => {
    expect(ids(new Date(2026, 10, 20, 17, 30))).toEqual([
      "tomorrow",
      "next-week",
    ]);
  });

  it("doesn't offer next week twice on a Sunday", () => {
    expect(ids(new Date(2026, 10, 22, 9))).toEqual(["later-today", "tomorrow"]);
  });
});
