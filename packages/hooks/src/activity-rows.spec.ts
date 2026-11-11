import { describe, expect, it } from "vitest";
import { activityGroups, type Activity } from "./activity-rows";

const task = (overrides: Record<string, unknown> = {}) => ({
  id: "task-1",
  title: "Book the venue",
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
  closes_at: "2099-01-01T00:00:00.000Z",
  closed_at: null,
  is_closed: false,
  has_voted: false,
  created_at: "2026-11-01T00:00:00.000Z",
  message: {},
  ...overrides,
});
const event = (overrides: Record<string, unknown> = {}) => ({
  id: "event-1",
  name: "Chapter meeting",
  location: "Great Room",
  start_time: "2099-01-01T19:00:00.000Z",
  end_time: "2099-01-01T20:00:00.000Z",
  attendance: "required",
  point_value: 10,
  check_in_opens_minutes: 10,
  check_in_open: false,
  checked_in: null,
  ...overrides,
});

const activity = (overrides: Partial<Record<string, unknown>> = {}) =>
  ({
    needs_you: {
      tasks: [],
      task_confirmations: [],
      hours_approvals: [],
      polls: [],
    },
    coming_up: [],
    made_by_you: { polls: [], tasks: [], files: [], events: [] },
    needs_you_count: 0,
    unavailable: [],
    ...overrides,
  }) as unknown as Activity;

const rowsOf = (
  data: Activity,
  filter: Parameters<typeof activityGroups>[1] = "all",
) =>
  Object.fromEntries(
    activityGroups(data, filter).map((group) => [
      group.id,
      group.rows.map(
        (row) => `${row.kind}:${row.title}:${row.badge?.label ?? "-"}`,
      ),
    ]),
  );

describe("activityGroups", () => {
  it("draws the three groups in order, Needs you first", () => {
    expect(
      activityGroups(activity(), "all").map((group) => group.label),
    ).toEqual(["Needs you", "Coming up", "Made by you"]);
  });

  it("puts an event the member can check in to under Needs you, and not again under Coming up", () => {
    const data = activity({
      coming_up: [
        event({
          id: "now",
          name: "Now",
          check_in_open: true,
          checked_in: false,
        }),
        event({
          id: "in",
          name: "Already in",
          check_in_open: true,
          checked_in: true,
        }),
        event({ id: "later", name: "Later" }),
      ],
    });

    expect(rowsOf(data)).toMatchObject({
      "needs-you": ["event:Now:Check in"],
      "coming-up": ["event:Already in:Checked in", "event:Later:Required"],
    });
  });

  it("says what each row asks of the member", () => {
    const data = activity({
      needs_you: {
        tasks: [
          task({
            title: "Late",
            status: "OVERDUE",
            stored_status: "IN_PROGRESS",
          }),
        ],
        task_confirmations: [
          task({
            id: "t2",
            title: "Done by Ada",
            status: "COMPLETED",
            stored_status: "COMPLETED",
          }),
        ],
        hours_approvals: [
          {
            id: "h1",
            user_id: "ada",
            member_name: "Ada",
            date: "2026-11-08",
            duration_minutes: 90,
            description: "Food bank",
            created_at: "2026-11-08T00:00:00.000Z",
          },
        ],
        polls: [poll()],
      },
    });

    expect(rowsOf(data)["needs-you"]).toEqual([
      "task:Late:Overdue",
      "task:Done by Ada:Confirm",
      "hours:Food bank:Approve",
      "poll:Formal venue?:Vote",
    ]);
  });

  it("gives a finished task no due countdown, and the shared word for where it stands", () => {
    const done = {
      due_date: "2020-01-01",
      status: "COMPLETED",
      stored_status: "COMPLETED",
      assignee_name: "Ada",
    };
    const [, , made] = activityGroups(
      activity({
        made_by_you: {
          polls: [],
          tasks: [
            task({ id: "waiting", ...done }),
            task({
              id: "confirmed",
              ...done,
              confirmed_at: "2026-11-02T00:00:00.000Z",
            }),
          ],
          files: [],
          events: [],
        },
      }),
      "all",
    );

    expect(made?.rows.map((row) => [row.detail, row.badge?.label])).toEqual([
      ["Ada", "Waiting on an officer"],
      ["Ada", "Confirmed"],
    ]);
  });

  it("names each section that could not be read, under every group that draws it", () => {
    const groups = activityGroups(
      activity({ unavailable: ["tasks", "hours_approvals", "files"] }),
      "all",
    );

    expect(groups.map((group) => group.unavailable)).toEqual([
      ["tasks", "hours_approvals"],
      [],
      ["tasks", "files"],
    ]);
  });

  it("keeps a failed section's notice under its own chip, and only there", () => {
    const data = activity({
      unavailable: [
        "tasks",
        "hours_approvals",
        "polls",
        "coming_up",
        "files",
        "made_events",
      ],
    });
    const under = (filter: Parameters<typeof activityGroups>[1]) =>
      activityGroups(data, filter).map((group) => group.unavailable);

    expect(under("task")).toEqual([["tasks"], [], ["tasks"]]);
    expect(under("hours")).toEqual([["hours_approvals"], [], []]);
    expect(under("poll")).toEqual([["polls"], [], ["polls"]]);
    expect(under("event")).toEqual([
      ["coming_up"],
      ["coming_up"],
      ["made_events"],
    ]);
    expect(under("file")).toEqual([[], [], ["files"]]);
  });

  it("lists an event the member made under Made by you, apart from the same event under Coming up", () => {
    const mine = event({ id: "mine", name: "Formal" });
    const data = activity({
      coming_up: [mine],
      made_by_you: { polls: [], tasks: [], files: [], events: [mine] },
    });

    expect(rowsOf(data)).toMatchObject({
      "coming-up": ["event:Formal:Required"],
      "made-by-you": ["event:Formal:Required"],
    });
    const keys = activityGroups(data, "all").flatMap((group) =>
      group.rows.map((row) => row.key),
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("labels a direct-message poll without its server-made channel name", () => {
    const [needs] = activityGroups(
      activity({
        needs_you: {
          tasks: [],
          task_confirmations: [],
          hours_approvals: [],
          polls: [
            poll({
              channel_type: "DM",
              channel_name: "dm-a-b",
              closes_at: null,
            }),
          ],
        },
      }),
      "all",
    );

    expect(needs?.rows[0]?.detail).toBe("Direct message · no closing time");
  });

  it("keeps one row per place when the same task is both waiting and made by the member", () => {
    const shared = task({
      id: "same",
      status: "COMPLETED",
      stored_status: "COMPLETED",
    });
    const groups = activityGroups(
      activity({
        needs_you: {
          tasks: [],
          task_confirmations: [shared],
          hours_approvals: [],
          polls: [],
        },
        made_by_you: { polls: [], tasks: [shared], files: [], events: [] },
      }),
      "all",
    );
    const keys = groups.flatMap((group) => group.rows.map((row) => row.key));

    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(2);
  });

  it("narrows every group to the chip's kind", () => {
    const data = activity({
      needs_you: {
        tasks: [task()],
        task_confirmations: [],
        hours_approvals: [],
        polls: [poll()],
      },
      coming_up: [event()],
      made_by_you: {
        polls: [
          poll({ message_id: "mine", question: "Mine", is_closed: true }),
        ],
        tasks: [],
        files: [
          {
            id: "f1",
            source: "document",
            title: "Bylaws",
            created_at: "2026-11-01T00:00:00.000Z",
          },
        ],
        events: [],
      },
    });

    expect(rowsOf(data, "poll")).toEqual({
      "needs-you": ["poll:Formal venue?:Vote"],
      "coming-up": [],
      "made-by-you": ["poll:Mine:Closed"],
    });
  });

  it("names a section that could not be read, under the group it belongs to and the chip that shows it", () => {
    const data = activity({ unavailable: ["polls", "coming_up"] });

    const all = activityGroups(data, "all");
    expect(all.map((group) => group.unavailable)).toEqual([
      ["polls", "coming_up"],
      ["coming_up"],
      ["polls"],
    ]);

    const tasksOnly = activityGroups(data, "task");
    expect(tasksOnly.every((group) => group.unavailable.length === 0)).toBe(
      true,
    );
  });
});
