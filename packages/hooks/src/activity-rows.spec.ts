import { describe, expect, it } from "vitest";
import { NAV_GLYPHS } from "@repo/theme/nav-glyphs";
import {
  ACTIVITY_GLYPH_NAV,
  activityBadgeIsAsk,
  activityGroups,
  activityLinkKind,
  activityNeedsYouHeadline,
  activityNextUpLine,
  activityPollIsOpen,
  activityRowAction,
  parseActivityFilter,
  activityFilterAvailable,
  activityRowIsNow,
  activitySummary,
  activityDetailParts,
  type Activity,
  type ActivityRow,
} from "./activity-rows";

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

const link = (overrides: Record<string, unknown> = {}) => ({
  id: "link-1",
  url: "https://docs.google.com/forms/d/e/abc/viewform",
  host: "docs.google.com",
  title: null,
  message_id: "message-1",
  thread_root_id: null,
  channel_id: "channel-1",
  channel_name: "rush",
  channel_type: "PUBLIC",
  posted_by: "olive",
  posted_by_name: "Olive",
  posted_at: "2026-11-10T15:00:00.000Z",
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
    links: [],
    made_by_you: { polls: [], tasks: [], events: [] },
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
  it("draws the four groups in order, Needs you first", () => {
    expect(
      activityGroups(activity(), "all").map((group) => group.label),
    ).toEqual(["Needs you", "Coming up", "Links", "Made by you"]);
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
    const [, , , made] = activityGroups(
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
      activity({ unavailable: ["tasks", "hours_approvals", "made_events"] }),
      "all",
    );

    expect(groups.map((group) => group.unavailable)).toEqual([
      ["tasks", "hours_approvals"],
      [],
      [],
      ["made_events", "tasks"],
    ]);
  });

  it("keeps a failed section's notice under its own chip, and only there", () => {
    const data = activity({
      unavailable: [
        "tasks",
        "hours_approvals",
        "polls",
        "coming_up",
        "made_events",
      ],
    });
    const under = (filter: Parameters<typeof activityGroups>[1]) =>
      activityGroups(data, filter).map((group) => group.unavailable);

    expect(under("task")).toEqual([["tasks"], [], [], ["tasks"]]);
    expect(under("hours")).toEqual([["hours_approvals"], [], [], []]);
    expect(under("poll")).toEqual([["polls"], [], [], ["polls"]]);
    expect(under("event")).toEqual([
      ["coming_up"],
      ["coming_up"],
      [],
      ["made_events"],
    ]);
  });

  it("lists an event the member made under Made by you, apart from the same event under Coming up", () => {
    const mine = event({ id: "mine", name: "Formal" });
    const data = activity({
      coming_up: [mine],
      made_by_you: { polls: [], tasks: [], events: [mine] },
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
        made_by_you: { polls: [], tasks: [shared], events: [] },
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
        polls: [poll({ message_id: "mine", question: "Mine" })],
        tasks: [],
        events: [],
      },
    });

    expect(rowsOf(data, "poll")).toEqual({
      "needs-you": ["poll:Formal venue?:Vote"],
      "coming-up": [],
      links: [],
      "made-by-you": ["poll:Mine:Vote"],
    });
  });

  describe("closed polls (#4258)", () => {
    const NOW = new Date("2026-11-11T12:00:00.000Z");
    const data = activity({
      needs_you: {
        tasks: [],
        task_confirmations: [],
        hours_approvals: [],
        polls: [
          // Open at the read; its time ran out before `NOW`.
          poll({
            message_id: "lapsed",
            question: "Lapsed",
            closes_at: "2026-11-11T11:00:00.000Z",
          }),
          poll({
            message_id: "open",
            question: "Open",
            closes_at: "2026-11-11T13:00:00.000Z",
          }),
        ],
      },
      made_by_you: {
        polls: [
          poll({
            message_id: "m-open",
            question: "Still open",
            closes_at: null,
          }),
          poll({
            message_id: "m-by-hand",
            question: "Closed by hand",
            is_closed: true,
            closed_at: "2026-11-10T09:00:00.000Z",
            closes_at: "2026-11-20T00:00:00.000Z",
            created_at: "2026-11-09T00:00:00.000Z",
          }),
          poll({
            message_id: "m-by-time",
            question: "Ran out",
            closes_at: "2026-11-11T10:00:00.000Z",
            created_at: "2026-11-08T00:00:00.000Z",
          }),
        ],
        tasks: [],
        events: [],
      },
      needs_you_count: 2,
    });

    it("lists open polls only, and keeps the closed ones behind Archived polls, newest closed first", () => {
      const groups = activityGroups(data, "all", NOW);
      const needs = groups.find((group) => group.id === "needs-you");
      const made = groups.find((group) => group.id === "made-by-you");

      expect(needs?.rows.map((row) => row.title)).toEqual(["Open"]);
      expect(made?.rows.map((row) => row.title)).toEqual(["Still open"]);
      expect(made?.archive?.label).toBe("Archived polls");
      expect(
        made?.archive?.rows.map((row) => [row.title, row.badge?.label]),
      ).toEqual([
        ["Ran out", "Closed"],
        ["Closed by hand", "Closed"],
      ]);
      expect(groups.filter((group) => group.archive).map((g) => g.id)).toEqual([
        "made-by-you",
      ]);
    });

    it("keeps the archive under the Polls chip, and drops it under any other", () => {
      const made = (filter: Parameters<typeof activityGroups>[1]) =>
        activityGroups(data, filter, NOW).find(
          (group) => group.id === "made-by-you",
        );
      expect(made("poll")?.archive?.rows).toHaveLength(2);
      expect(made("task")?.archive).toBeNull();
    });

    it("has no archive while every poll is open", () => {
      const made = activityGroups(
        activity({
          made_by_you: {
            polls: [poll({ message_id: "m", closes_at: null })],
            tasks: [],
            events: [],
          },
        }),
        "all",
        NOW,
      ).find((group) => group.id === "made-by-you");
      expect(made?.archive).toBeNull();
    });

    it("counts open polls only in the tile and the headline", () => {
      const summary = activitySummary(
        data,
        { canConfirmTasks: false, canApproveHours: false },
        NOW,
      );
      expect(summary.tiles.find((tile) => tile.id === "polls")?.count).toBe(
        "1",
      );
      expect(summary.needsYou).toBe(1);
    });

    it("reads a poll as open until its closing time and closed from then on", () => {
      const at = { is_closed: false, closes_at: "2026-11-11T12:00:00.000Z" };
      expect(activityPollIsOpen(at, new Date("2026-11-11T11:59:59.000Z"))).toBe(
        true,
      );
      expect(activityPollIsOpen(at, NOW)).toBe(false);
      expect(
        activityPollIsOpen({ is_closed: true, closes_at: null }, NOW),
      ).toBe(false);
      expect(
        activityPollIsOpen({ is_closed: false, closes_at: null }, NOW),
      ).toBe(true);
    });
  });

  it("names a section that could not be read, under the group it belongs to and the chip that shows it", () => {
    const data = activity({ unavailable: ["polls", "coming_up"] });

    const all = activityGroups(data, "all");
    expect(all.map((group) => group.unavailable)).toEqual([
      ["polls", "coming_up"],
      ["coming_up"],
      [],
      ["polls"],
    ]);

    const tasksOnly = activityGroups(data, "task");
    expect(tasksOnly.every((group) => group.unavailable.length === 0)).toBe(
      true,
    );
  });

  it("lists sign-up links in their own group, said by what they are, who posted them and where", () => {
    const data = activity({
      links: [
        link(),
        link({
          id: "link-2",
          url: "https://calendly.com/olive/rush",
          host: "calendly.com",
          posted_by: null,
          posted_by_name: "",
          channel_type: "DM",
          channel_name: "dm-a-b",
        }),
      ],
    });
    const group = activityGroups(data, "all").find((g) => g.id === "links")!;

    expect(group.rows.map((row) => row.title)).toEqual([
      "Google Form",
      "Calendly",
    ]);
    expect(group.rows[0]!.detail).toMatch(/^Olive · #rush · /);
    // No poster name for an imported author, and no server-made DM name.
    expect(group.rows[1]!.detail).toMatch(/^Direct message · /);
    expect(group.rows.every((row) => row.badge === null)).toBe(true);
  });

  it("titles a link by its page's name, with its kind leading the detail (#4187)", () => {
    const data = activity({
      links: [
        link({ title: "5K volunteer shifts" }),
        link({
          id: "link-2",
          url: "https://docs.google.com/spreadsheets/d/abc/edit",
          title: "  ",
        }),
      ],
    });
    const group = activityGroups(data, "all").find((g) => g.id === "links")!;

    expect(group.rows[0]!.title).toBe("5K volunteer shifts");
    expect(group.rows[0]!.detail).toMatch(/^Google Form · Olive · #rush · /);
    // A blank name is no name: the row keeps its kind, and the detail doesn't repeat it.
    expect(group.rows[1]!.title).toBe("Google Sheet");
    expect(group.rows[1]!.detail).toMatch(/^Olive · #rush · /);
  });

  it("narrows to links under the Links chip, and names a links read that failed there", () => {
    const data = activity({
      links: [link()],
      needs_you: {
        tasks: [task()],
        task_confirmations: [],
        hours_approvals: [],
        polls: [],
      },
      unavailable: ["links"],
    });

    expect(rowsOf(data, "link")).toEqual({
      "needs-you": [],
      "coming-up": [],
      links: ["link:Google Form:-"],
      "made-by-you": [],
    });
    expect(
      activityGroups(data, "task").find((g) => g.id === "links")!.unavailable,
    ).toEqual([]);
    expect(
      activityGroups(data, "link").find((g) => g.id === "links")!.unavailable,
    ).toEqual(["links"]);
  });
});

describe("Now and Later, and Made by you by kind (#4173)", () => {
  // Wednesday 11 November 2026, midday local time.
  const NOW = new Date(2026, 10, 11, 12, 0, 0);
  const partsOf = (
    data: Activity,
    filter: Parameters<typeof activityGroups>[1] = "all",
  ) =>
    Object.fromEntries(
      activityGroups(data, filter, NOW).map((group) => [
        group.id,
        group.parts.map((part) => ({
          label: part.label,
          titles: part.rows.map((row) => row.title),
          limit: part.limit,
        })),
      ]),
    );

  it("puts what is due today or tomorrow, overdue, or waiting on a confirm or approval under Now", () => {
    const data = activity({
      needs_you: {
        tasks: [
          task({ id: "a", title: "Due tomorrow", due_date: "2026-11-12" }),
          task({ id: "b", title: "Due next week", due_date: "2026-11-18" }),
          task({
            id: "c",
            title: "Overdue",
            status: "OVERDUE",
            due_date: "2026-11-02",
          }),
        ],
        task_confirmations: [
          task({
            id: "d",
            title: "Confirm me",
            status: "COMPLETED",
            stored_status: "COMPLETED",
          }),
        ],
        hours_approvals: [],
        polls: [
          poll({
            message_id: "p1",
            question: "Closes tonight",
            closes_at: "2026-11-11T23:00:00",
          }),
          poll({ message_id: "p2", question: "Open-ended", closes_at: null }),
        ],
      },
    });
    expect(partsOf(data)["needs-you"]).toEqual([
      {
        label: "Now",
        titles: ["Due tomorrow", "Overdue", "Confirm me", "Closes tonight"],
        limit: 5,
      },
      { label: "Later", titles: ["Due next week", "Open-ended"], limit: 5 },
    ]);
  });

  it("draws the line at tomorrow for a task and at a day for a poll", () => {
    const data = activity({
      needs_you: {
        tasks: [
          task({ id: "a", title: "Due tomorrow", due_date: "2026-11-12" }),
          task({ id: "b", title: "Due in two days", due_date: "2026-11-13" }),
        ],
        task_confirmations: [],
        hours_approvals: [],
        polls: [
          poll({
            message_id: "p1",
            question: "Closes in 23h",
            closes_at: "2026-11-12T11:00:00",
          }),
          poll({
            message_id: "p2",
            question: "Closes in 25h",
            closes_at: "2026-11-12T13:00:00",
          }),
        ],
      },
    });
    expect(partsOf(data)["needs-you"]?.map((p) => p.titles)).toEqual([
      ["Due tomorrow", "Closes in 23h"],
      ["Due in two days", "Closes in 25h"],
    ]);
  });

  it("narrows to the confirmations alone under the To confirm tile's filter", () => {
    const data = activity({
      needs_you: {
        tasks: [task({ id: "mine", title: "Mine" })],
        task_confirmations: [task({ id: "c", title: "To confirm" })],
        hours_approvals: [],
        polls: [],
      },
      made_by_you: {
        polls: [],
        events: [],
        tasks: [task({ id: "m", title: "Assigned" })],
      },
      unavailable: ["tasks"],
    });
    const groups = activityGroups(data, "confirm", NOW);
    expect(groups.map((group) => group.rows.map((row) => row.title))).toEqual([
      ["To confirm"],
      [],
      [],
      [],
    ]);
    // The confirmations come from the tasks read, so its failure shows here.
    expect(groups[0]!.unavailable).toEqual(["tasks"]);
  });

  it("draws Needs you as one part with no heading when everything is now, or everything later", () => {
    const data = activity({
      needs_you: {
        tasks: [task({ due_date: "2026-11-30" })],
        task_confirmations: [],
        hours_approvals: [],
        polls: [],
      },
    });
    expect(partsOf(data)["needs-you"]).toEqual([
      { label: null, titles: ["Book the venue"], limit: 5 },
    ]);
  });

  it("keeps a part's id when the other side empties, so an open Show all stays open", () => {
    const needsIds = (data: Activity) =>
      activityGroups(data, "all", NOW)
        .find((group) => group.id === "needs-you")!
        .parts.map((part) => part.id);
    const later = task({ id: "later", due_date: "2026-11-30" });
    const split = activity({
      needs_you: {
        tasks: [later],
        task_confirmations: [task({ id: "c1", title: "Confirm me" })],
        hours_approvals: [],
        polls: [],
      },
    });
    expect(needsIds(split)).toEqual(["now", "later"]);
    // The confirmation is acted on and leaves: Later is still "later".
    const laterOnly = activity({
      needs_you: {
        tasks: [later],
        task_confirmations: [],
        hours_approvals: [],
        polls: [],
      },
    });
    expect(needsIds(laterOnly)).toEqual(["later"]);
    const nowOnly = activity({
      needs_you: {
        tasks: [],
        task_confirmations: [task({ id: "c1", title: "Confirm me" })],
        hours_approvals: [],
        polls: [],
      },
    });
    expect(needsIds(nowOnly)).toEqual(["now"]);
  });

  it("splits Made by you by kind, a few rows each, and leaves out an empty kind", () => {
    const data = activity({
      made_by_you: {
        polls: [poll({ question: "Shirt color" })],
        events: [],
        tasks: [1, 2, 3, 4].map((n) =>
          task({ id: `t${n}`, title: `Task ${n}` }),
        ),
      },
    });
    expect(partsOf(data)["made-by-you"]).toEqual([
      { label: "Polls you posted", titles: ["Shirt color"], limit: 3 },
      {
        label: "Tasks you assigned",
        titles: ["Task 1", "Task 2", "Task 3", "Task 4"],
        limit: 3,
      },
    ]);
  });

  it("holds nothing back under a chip, where the member asked for that kind", () => {
    const data = activity({
      made_by_you: {
        polls: [],
        events: [],
        tasks: [1, 2, 3, 4].map((n) =>
          task({ id: `t${n}`, title: `Task ${n}` }),
        ),
      },
    });
    expect(partsOf(data, "task")["made-by-you"]?.[0]?.limit).toBeNull();
  });

  it("keeps the read's order in rows, for a client that draws them without the parts", () => {
    const data = activity({
      needs_you: {
        tasks: [
          task({ id: "a", title: "Later one", due_date: "2026-11-30" }),
          task({ id: "b", title: "Now one", due_date: "2026-11-11" }),
        ],
        task_confirmations: [],
        hours_approvals: [],
        polls: [],
      },
    });
    const needs = activityGroups(data, "all", NOW)[0]!;
    expect(needs.rows.map((row) => row.title)).toEqual([
      "Later one",
      "Now one",
    ]);
    expect(needs.parts.map((p) => p.rows.map((row) => row.title))).toEqual([
      ["Now one"],
      ["Later one"],
    ]);
  });

  it("gives each row its kind's glyph, and an event a date block whose detail leaves the day to the block", () => {
    const data = activity({
      needs_you: {
        tasks: [task()],
        task_confirmations: [task({ id: "c" })],
        hours_approvals: [],
        polls: [],
      },
      coming_up: [event({ start_time: "2026-11-12T17:00:00" })],
    });
    const groups = activityGroups(data, "all", NOW);
    expect(groups[0]!.rows.map((row) => row.glyph)).toEqual([
      "task",
      "confirm",
    ]);
    const coming = groups[1]!.rows[0]!;
    expect(coming.glyph).toBe("event");
    expect(coming.dateBlock).toEqual({ month: "NOV", day: "12" });
    // The block is decoration: the detail says the day in words.
    expect(coming.detail).toMatch(/^Tomorrow · .* · Great Room$/);
    expect(groups[0]!.rows.every((row) => row.dateBlock === null)).toBe(true);
  });

  it("calls a warning badge an ask, and nothing else", () => {
    expect(
      activityBadgeIsAsk({ badge: { label: "Vote", variant: "warning" } }),
    ).toBe(true);
    expect(
      activityBadgeIsAsk({
        badge: { label: "Overdue", variant: "destructive" },
      }),
    ).toBe(false);
    expect(activityBadgeIsAsk({ badge: null })).toBe(false);
  });

  it("counts an event open for check-in as now", () => {
    const data = activity({
      coming_up: [event({ check_in_open: true, checked_in: false })],
    });
    const row = activityGroups(data, "all", NOW)[0]!.rows[0]!;
    expect(activityRowIsNow(row, NOW)).toBe(true);
  });
});

describe("activitySummary (#4173)", () => {
  const NOW = new Date(2026, 10, 11, 12, 0, 0);
  const data = activity({
    needs_you: {
      tasks: [task(), task({ id: "t2" })],
      task_confirmations: [task({ id: "c1" })],
      hours_approvals: [{ id: "h1" }, { id: "h2" }, { id: "h3" }],
      polls: [],
    },
    coming_up: [
      event({ id: "past", name: "Started", start_time: "2026-11-11T11:00:00" }),
      event({
        id: "next",
        name: "Exec sync",
        start_time: "2026-11-12T17:00:00",
      }),
    ],
    needs_you_count: 6,
  });

  it("gives an officer a tile per ask, and the next event still ahead", () => {
    const summary = activitySummary(
      data,
      { canConfirmTasks: true, canApproveHours: true },
      NOW,
    );
    expect(summary.needsYou).toBe(6);
    expect(
      summary.tiles.map((tile) => [
        tile.id,
        tile.count,
        tile.zero,
        tile.filter,
      ]),
    ).toEqual([
      ["tasks", "2", false, "task"],
      ["confirm", "1", false, "confirm"],
      ["approve", "3", false, "hours"],
      ["polls", "0", true, "poll"],
    ]);
    expect(summary.incomplete).toBe(false);
    expect(summary.nextEvent?.name).toBe("Exec sync");
  });

  it("shows a member no confirm or approve tile, and no tile for a module that is off", () => {
    const summary = activitySummary(
      data,
      {
        canConfirmTasks: false,
        canApproveHours: false,
        isModuleEnabled: (module) => module !== "polls",
      },
      NOW,
    );
    expect(summary.tiles.map((tile) => tile.id)).toEqual(["tasks"]);
  });

  it("adds a check-in tile first, only while an event is open for check-in", () => {
    const open = activity({
      coming_up: [event({ check_in_open: true, checked_in: false })],
    });
    const summary = activitySummary(
      open,
      { canConfirmTasks: false, canApproveHours: false },
      NOW,
    );
    expect(summary.tiles[0]).toMatchObject({
      id: "check-in",
      count: "1",
      filter: "event",
    });
  });

  it("says 25+ on a tile whose list reached the read's cap", () => {
    const full = activity({
      needs_you: {
        tasks: Array.from({ length: 25 }, (_, n) => task({ id: `t${n}` })),
        task_confirmations: [],
        hours_approvals: [],
        polls: [],
      },
    });
    const summary = activitySummary(
      full,
      { canConfirmTasks: false, canApproveHours: false },
      NOW,
    );
    expect(summary.tiles[0]).toMatchObject({ id: "tasks", count: "25+" });
  });

  it("draws a tile whose section failed as unknown, and never says caught up then", () => {
    const failed = activity({ unavailable: ["tasks"], needs_you_count: 0 });
    const summary = activitySummary(
      failed,
      { canConfirmTasks: true, canApproveHours: false },
      NOW,
    );
    expect(summary.incomplete).toBe(true);
    expect(summary.tiles.slice(0, 2)).toMatchObject([
      { id: "tasks", count: null, zero: false },
      { id: "confirm", count: null, zero: false },
    ]);
    expect(activityNeedsYouHeadline(summary)).toBe(
      "Some of what needs you couldn't load",
    );
  });

  it("says how many things need you in words", () => {
    const says = (needsYou: number, incomplete = false) =>
      activityNeedsYouHeadline({ needsYou, incomplete });
    expect(says(0)).toBe("You're all caught up");
    expect(says(1)).toBe("1 thing needs you");
    expect(says(8)).toBe("8 things need you");
    expect(says(8, true)).toBe("At least 8 things need you");
  });
});

describe("activityLinkKind", () => {
  it.each([
    [
      "docs.google.com",
      "https://docs.google.com/forms/d/e/x/viewform",
      "Google Form",
    ],
    [
      "docs.google.com",
      "https://docs.google.com/a/school.edu/forms/d/x",
      "Google Form",
    ],
    [
      "docs.google.com",
      "https://docs.google.com/spreadsheets/d/x",
      "Google Sheet",
    ],
    ["docs.google.com", "https://docs.google.com/document/d/x", "Google Doc"],
    [
      "docs.google.com",
      "https://docs.google.com/presentation/d/x",
      "docs.google.com",
    ],
    ["forms.gle", "https://forms.gle/abc", "Google Form"],
    ["forms.office.com", "https://forms.office.com/r/abc", "Microsoft Form"],
    [
      "forms.cloud.microsoft",
      "https://forms.cloud.microsoft/r/abc",
      "Microsoft Form",
    ],
    ["chapter.typeform.com", "https://chapter.typeform.com/to/abc", "Typeform"],
    ["signupgenius.com", "https://signupgenius.com/go/abc", "SignUpGenius"],
    ["calendly.com", "https://calendly.com/olive", "Calendly"],
    ["example.org", "https://example.org/x", "example.org"],
  ])("names %s (%s) as %s", (host, url, expected) => {
    expect(activityLinkKind({ host, url })).toBe(expected);
  });
});

describe("ACTIVITY_GLYPH_NAV", () => {
  it("names a shape in the shared nav set for every kind", () => {
    for (const name of Object.values(ACTIVITY_GLYPH_NAV)) {
      expect(NAV_GLYPHS[name]).toBeDefined();
    }
    // A task and a confirmation read apart at a glance.
    expect(ACTIVITY_GLYPH_NAV.confirm).not.toBe(ACTIVITY_GLYPH_NAV.task);
  });
});

describe("activityNextUpLine", () => {
  it("names the next event and when it starts", () => {
    const line = activityNextUpLine({
      nextEvent: {
        name: "Exec Board Sync",
        start_time: "2099-03-07T19:00:00.000Z",
      } as never,
    });
    expect(line).toMatch(/^Next up: Exec Board Sync · \S/);
  });

  it("is nothing when no event is ahead", () => {
    expect(activityNextUpLine({ nextEvent: null })).toBeNull();
  });
});

describe("activityRowAction (#4402)", () => {
  it("puts the one-press asks on the row, and never Vote or a status", () => {
    const data = activity({
      needs_you: {
        tasks: [task({ id: "mine", title: "Mine" })],
        task_confirmations: [
          task({ id: "done", title: "Done", status: "COMPLETED" }),
        ],
        hours_approvals: [
          {
            id: "h1",
            user_id: "u2",
            member_name: "Sam",
            date: "2026-11-10",
            duration_minutes: 60,
            description: "Food bank",
            created_at: "2026-11-10T00:00:00.000Z",
          },
        ],
        polls: [poll()],
      },
      coming_up: [
        event({
          id: "open",
          name: "Open",
          check_in_open: true,
          checked_in: false,
        }),
        event({ id: "later", name: "Later" }),
      ],
    });
    const actions = Object.fromEntries(
      activityGroups(data, "all", new Date("2026-11-12T00:00:00.000Z"))
        .flatMap((group) => group.rows)
        .map((row) => [row.title, activityRowAction(row)]),
    );
    expect(actions).toEqual({
      // Not yet: an event may need a location the web can't give (#4427).
      Open: null,
      Mine: null,
      Done: "confirm",
      "Food bank": "approve",
      "Formal venue?": null,
      Later: null,
    });
  });
});

describe("the Needs you filter (#4402)", () => {
  it("keeps every kind waiting on the member and empties the other groups", () => {
    const data = activity({
      needs_you: {
        tasks: [task({ id: "mine", title: "Mine" })],
        task_confirmations: [],
        hours_approvals: [],
        polls: [poll()],
      },
      coming_up: [event({ id: "later", name: "Later" })],
      links: [link()],
      made_by_you: {
        polls: [poll({ message_id: "p9", question: "Mine?" })],
        tasks: [],
        events: [],
      },
      unavailable: ["links"],
    });
    const groups = activityGroups(
      data,
      "waiting",
      new Date("2026-11-12T00:00:00.000Z"),
    );
    const byId = Object.fromEntries(groups.map((group) => [group.id, group]));
    expect(byId["needs-you"]!.rows.map((row) => row.title).sort()).toEqual([
      "Formal venue?",
      "Mine",
    ]);
    for (const id of ["coming-up", "links", "made-by-you"] as const) {
      expect(byId[id]!.rows).toEqual([]);
      expect(byId[id]!.unavailable).toEqual([]);
      expect(byId[id]!.archive).toBeNull();
    }
    // Nothing held back under a chip.
    expect(byId["needs-you"]!.parts.every((part) => part.limit === null)).toBe(
      true,
    );
  });

  it("says a Needs you section that couldn't load, whatever its kind", () => {
    const groups = activityGroups(
      activity({ unavailable: ["polls", "hours_approvals"] }),
      "waiting",
    );
    expect(
      groups.find((group) => group.id === "needs-you")!.unavailable,
    ).toEqual(["hours_approvals", "polls"]);
  });
});

describe("parseActivityFilter", () => {
  it("reads back a chip and nothing else", () => {
    expect(parseActivityFilter("waiting")).toBe("waiting");
    expect(parseActivityFilter("link")).toBe("link");
    expect(parseActivityFilter("confirm")).toBeNull();
    expect(parseActivityFilter("bogus")).toBeNull();
    expect(parseActivityFilter(null)).toBeNull();
  });
});

describe("activityFilterAvailable", () => {
  it("drops a kind whose module the chapter has off, and nothing else", () => {
    const off = (module: string) => module !== "hours" && module !== "polls";
    expect(activityFilterAvailable("hours", off)).toBe(false);
    expect(activityFilterAvailable("poll", off)).toBe(false);
    expect(activityFilterAvailable("task", off)).toBe(true);
    expect(activityFilterAvailable("link", off)).toBe(true);
    expect(activityFilterAvailable("waiting", off)).toBe(true);
    expect(activityFilterAvailable("hours")).toBe(true);
  });
});

describe("faces and closing soon (#4402, item 4)", () => {
  const NOW = new Date("2026-11-11T12:00:00.000Z");
  const IN = (minutes: number) =>
    new Date(NOW.getTime() + minutes * 60_000).toISOString();
  const rows = (data: Activity): ActivityRow[] =>
    activityGroups(data, "all", NOW).flatMap((group) => group.rows);
  const needsYou = (
    needs: Partial<Record<string, unknown[]>>,
    rest: Record<string, unknown> = {},
  ) =>
    activity({
      needs_you: {
        tasks: [],
        task_confirmations: [],
        hours_approvals: [],
        polls: [],
        ...needs,
      },
      ...rest,
    });

  it("leads each row with whoever it is from, never the member themselves", () => {
    const data = needsYou(
      {
        tasks: [
          task({ id: "from-olive" }),
          task({ id: "own", title: "Own", created_by: "me" }),
        ],
        task_confirmations: [
          task({
            id: "done",
            title: "Done",
            assignee_id: "pledge",
            assignee_name: "Pat",
            created_by: "me",
            status: "COMPLETED",
            stored_status: "COMPLETED",
            completed_at: "2026-11-10T00:00:00.000Z",
          }),
        ],
        hours_approvals: [
          {
            id: "hours-1",
            user_id: "sam",
            member_name: "Sam",
            date: "2026-11-10",
            duration_minutes: 90,
            description: "Food bank",
            created_at: "2026-11-10T00:00:00.000Z",
          },
        ],
        polls: [poll()],
      },
      {
        links: [link()],
        coming_up: [event()],
        made_by_you: {
          polls: [poll({ message_id: "mine", question: "Mine?" })],
          tasks: [task({ id: "assigned", title: "Assigned" })],
          events: [],
        },
      },
    );
    expect(
      Object.fromEntries(rows(data).map((row) => [row.key, row.faceId])),
    ).toEqual({
      "needs:task:from-olive": "officer",
      "needs:task:own": null,
      "needs-confirm:task:done": "pledge",
      "needs:hours:hours-1": "sam",
      "needs:poll:poll-1": "officer",
      "coming:event:event-1": null,
      "link:link-1": "olive",
      "made:poll:mine": null,
      "made:task:assigned": null,
    });
  });

  it("says a poll closing within a day relatively, as the detail's last segment", () => {
    const [row] = rows(needsYou({ polls: [poll({ closes_at: IN(150) })] }));
    expect(row!.soon).toBe("closes in 2 hours");
    expect(row!.detail).toBe("#general · closes in 2 hours");
    expect(activityDetailParts(row!)).toEqual({
      lead: "#general",
      soon: "closes in 2 hours",
    });
  });

  it("counts minutes in the last hour, and never says 0", () => {
    const soonOf = (minutes: number) =>
      rows(needsYou({ polls: [poll({ closes_at: IN(minutes) })] }))[0]!.soon;
    expect(soonOf(40)).toBe("closes in 40 minutes");
    expect(soonOf(0.5)).toBe("closes in 1 minute");
    expect(soonOf(61)).toBe("closes in 1 hour");
  });

  it("leaves a poll further out, closed, or with no closing time as it was", () => {
    const soonOf = (overrides: Record<string, unknown>) =>
      rows(needsYou({ polls: [poll(overrides)] }))[0]!.soon;
    expect(soonOf({ closes_at: IN(24 * 60) })).toBeNull();
    expect(soonOf({ closes_at: null })).toBeNull();
    // Closed by hand with time still on the clock: it sits in the archive.
    const archived = activityGroups(
      activity({
        made_by_you: {
          polls: [poll({ is_closed: true, closes_at: IN(30) })],
          tasks: [],
          events: [],
        },
      }),
      "all",
      NOW,
    ).flatMap((group) => group.archive?.rows ?? []);
    expect(archived).toHaveLength(1);
    expect(archived[0]!.soon).toBeNull();
    expect(archived[0]!.detail).toBe("#general");
  });

  it("says a timed task due within a day relatively; a bare date and overdue as before", () => {
    const [timed, bare, overdue] = rows(
      needsYou({
        tasks: [
          task({ id: "a", title: "A", due_at: IN(90), due_date: "2026-11-11" }),
          task({ id: "b", title: "B", due_at: null, due_date: "2026-11-11" }),
          task({
            id: "c",
            title: "C",
            status: "OVERDUE",
            due_at: IN(-90),
            due_date: "2026-11-11",
          }),
        ],
      }),
    );
    expect(timed!.soon).toBe("Due in 1 hour");
    expect(timed!.detail).toBe("from Olive · Due in 1 hour");
    expect(bare!.soon).toBeNull();
    expect(overdue!.soon).toBeNull();
    expect(overdue!.detail).toBe("from Olive · Overdue by 1 hour");
  });

  it("gives a finished task waiting on a confirm no countdown, whatever its due time", () => {
    const [row] = rows(
      needsYou({
        task_confirmations: [
          task({
            id: "done",
            assignee_id: "pledge",
            assignee_name: "Pat",
            status: "COMPLETED",
            stored_status: "COMPLETED",
            completed_at: "2026-11-11T11:00:00.000Z",
            due_at: IN(120),
          }),
        ],
      }),
    );
    expect(row!.soon).toBeNull();
    expect(row!.detail).toBe("Pat");
  });

  it("keeps the whole detail when nothing is closing soon", () => {
    expect(activityDetailParts({ detail: "a · b", soon: null })).toEqual({
      lead: "a · b",
      soon: null,
    });
    expect(
      activityDetailParts({ detail: "Due in 3 hours", soon: "Due in 3 hours" }),
    ).toEqual({ lead: "", soon: "Due in 3 hours" });
  });
});
