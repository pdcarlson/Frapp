import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NAV_GLYPHS } from "@repo/theme/nav-glyphs";
import {
  ACTIVITY_GLYPH_NAV,
  activityBadgeIsAsk,
  activityGroups,
  activityLinkKind,
  activityPollIsOpen,
  activityRowAction,
  activityDetailParts,
  activityReviewQueue,
  activityReviewRows,
  activityToDos,
  findActivityTaskRow,
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
  check_in_needs_location: false,
  check_in_needs_code: false,
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
  created_at: "2026-11-10T15:00:00.000Z",
  unread: false,
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

/** A row in one phrase: its kind, its title and what its badge says. */
const say = (row: ActivityRow) =>
  `${row.kind}:${row.title}:${row.badge?.label ?? "-"}`;

const rowsOf = (data: Activity) =>
  Object.fromEntries(
    activityGroups(data).map((group) => [group.id, group.rows.map(say)]),
  );

/** The member's own to-dos, each as it stands alone, in the read's order. */
const todoRows = (data: Activity, now?: Date): ActivityRow[] =>
  activityToDos(data, now).map((todo) => todo.dated);

/**
 * Every row the page draws from a read: the To review card's queue, the
 * member's own to-dos, then the groups under them.
 */
const allRows = (data: Activity, now?: Date): ActivityRow[] => [
  ...activityReviewRows(data, now),
  ...todoRows(data, now),
  ...activityGroups(data, now).flatMap((group) => group.rows),
];

describe("sign-up and form cards (#3926 step 4)", () => {
  const NOW = new Date("2026-11-13T12:00:00.000Z");
  const withCards = (
    cards: Record<string, unknown>[],
    extra: Record<string, unknown> = {},
  ) =>
    activity({
      needs_you: {
        tasks: [],
        task_confirmations: [],
        hours_approvals: [],
        polls: [],
        cards,
      },
      ...extra,
    });

  it("lists each on the To do list with its ask, kind and channel, and a read under its own kind", () => {
    const rows = todoRows(
      withCards([
        card({ message_id: "sheet" }),
        card({
          message_id: "head",
          kind: "headcount",
          title: "Formal",
          item_count: 2,
        }),
        card({
          message_id: "form",
          kind: "form",
          title: "Room picks",
          item_count: 1,
          channel_type: "DM",
        }),
      ]),
      NOW,
    );
    expect(
      rows.map((row) => [row.title, row.detail, row.badge?.label, row.glyph]),
    ).toEqual([
      ["Sober drivers", "Sign-up · 4 slots · #general", "Sign up", "signup"],
      ["Formal", "Headcount · #general", "Answer", "signup"],
      ["Room picks", "Form · 1 question · Direct message", "Fill out", "form"],
    ]);
    expect(rows.map((row) => row.readRef)).toEqual([
      { kind: "signup", item_id: "sheet" },
      { kind: "signup", item_id: "head" },
      { kind: "form", item_id: "form" },
    ]);
    expect(rows.every((row) => activityBadgeIsAsk(row))).toBe(true);
    // Answered on the card in chat: nothing to do on the row itself.
    expect(rows.map((row) => activityRowAction(row))).toEqual([
      null,
      null,
      null,
    ]);
    expect(rows[0]!.faceId).toBe("olive");
  });

  it("says a closing within a day in the warning phrase, and leaves once closed", () => {
    const soon = card({
      message_id: "soon",
      closes_at: "2026-11-13T15:00:00.000Z",
    });
    const later = card({
      message_id: "later",
      closes_at: "2026-11-20T15:00:00.000Z",
    });
    const gone = card({
      message_id: "gone",
      closes_at: "2026-11-13T11:00:00.000Z",
    });
    const rows = todoRows(withCards([soon, later, gone]), NOW);

    expect(rows.map((row) => row.readRef.item_id)).toEqual(["soon", "later"]);
    expect(rows[0]!.soon).toBe("closes in 3 hours");
    expect(rows[1]!.soon).toBeNull();
  });

  it("reads a cached read from before cards were served as none", () => {
    expect(todoRows(activity(), NOW)).toEqual([]);
  });

  it("draws the sign-up and form glyphs from the shared set", () => {
    expect(NAV_GLYPHS[ACTIVITY_GLYPH_NAV.signup]).toBeDefined();
    expect(NAV_GLYPHS[ACTIVITY_GLYPH_NAV.form]).toBeDefined();
  });
});

describe("activityGroups", () => {
  it("draws Waiting on others, then Links", () => {
    expect(activityGroups(activity()).map((group) => group.label)).toEqual([
      "Waiting on others",
      "Links",
    ]);
  });

  it("lists an event open for check-in with its ask, and leaves out one the member checked in to", () => {
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

    expect(todoRows(data).map(say)).toEqual([
      "event:Now:Check in",
      "event:Later:Required",
    ]);
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

    // The review queue, then the member's own list.
    expect(allRows(data).map(say)).toEqual([
      "task:Done by Ada:Confirm",
      "hours:Food bank:Approve",
      "task:Late:Overdue",
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
    const [made] = activityGroups(
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
    );

    expect(made?.rows.map((row) => [row.detail, row.badge?.label])).toEqual([
      ["Ada", "Waiting on an officer"],
      ["Ada", "Confirmed"],
    ]);
  });

  it("names each section that could not be read, under every group that draws it", () => {
    const groups = activityGroups(
      activity({
        unavailable: ["tasks", "hours_approvals", "made_events", "links"],
      }),
    );

    // Hours waiting on approval are the To review card's to name.
    expect(groups.map((group) => group.unavailable)).toEqual([
      ["made_events", "tasks"],
      ["links"],
    ]);
  });

  it("lists an event the member made under Waiting on others, apart from the same event on their To do list", () => {
    const mine = event({ id: "mine", name: "Formal" });
    const data = activity({
      coming_up: [mine],
      made_by_you: { polls: [], tasks: [], events: [mine] },
    });

    expect(todoRows(data).map(say)).toEqual(["event:Formal:Required"]);
    expect(rowsOf(data)).toMatchObject({
      "made-by-you": ["event:Formal:Required"],
    });
    const keys = allRows(data).map((row) => row.key);
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("labels a direct-message poll without its server-made channel name", () => {
    const [row] = todoRows(
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
    );

    expect(row?.detail).toBe("Direct message · no closing time");
  });

  it("keeps one row per place when the same task is both waiting and made by the member", () => {
    const shared = task({
      id: "same",
      status: "COMPLETED",
      stored_status: "COMPLETED",
    });
    const keys = allRows(
      activity({
        needs_you: {
          tasks: [],
          task_confirmations: [shared],
          hours_approvals: [],
          polls: [],
        },
        made_by_you: { polls: [], tasks: [shared], events: [] },
      }),
    ).map((row) => row.key);

    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(2);
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
      const groups = activityGroups(data, NOW);
      const made = groups.find((group) => group.id === "made-by-you");

      expect(todoRows(data, NOW).map((row) => row.title)).toEqual(["Open"]);
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

    it("has no archive while every poll is open", () => {
      const made = activityGroups(
        activity({
          made_by_you: {
            polls: [poll({ message_id: "m", closes_at: null })],
            tasks: [],
            events: [],
          },
        }),
        NOW,
      ).find((group) => group.id === "made-by-you");
      expect(made?.archive).toBeNull();
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
    const group = activityGroups(data).find((g) => g.id === "links")!;

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
    const group = activityGroups(data).find((g) => g.id === "links")!;

    expect(group.rows[0]!.title).toBe("5K volunteer shifts");
    expect(group.rows[0]!.detail).toMatch(/^Google Form · Olive · #rush · /);
    // A blank name is no name: the row keeps its kind, and the detail doesn't repeat it.
    expect(group.rows[1]!.title).toBe("Google Sheet");
    expect(group.rows[1]!.detail).toMatch(/^Olive · #rush · /);
  });

  it("keeps the links it has when the links read failed, and names the failure", () => {
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

    expect(rowsOf(data)).toEqual({
      "made-by-you": [],
      links: ["link:Google Form:-"],
    });
    expect(
      activityGroups(data).find((g) => g.id === "links")!.unavailable,
    ).toEqual(["links"]);
  });
});

describe("Waiting on others by kind (#4173)", () => {
  // Wednesday 11 November 2026, midday local time.
  const NOW = new Date(2026, 10, 11, 12, 0, 0);
  const partsOf = (data: Activity) =>
    Object.fromEntries(
      activityGroups(data, NOW).map((group) => [
        group.id,
        group.parts.map((part) => ({
          label: part.label,
          titles: part.rows.map((row) => row.title),
          limit: part.limit,
        })),
      ]),
    );

  it("splits Waiting on others by kind, a few rows each, and leaves out an empty kind", () => {
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
    const [coming, mine] = todoRows(data, NOW);
    const [waiting] = activityReviewRows(data, NOW);
    expect([mine!.glyph, waiting!.glyph]).toEqual(["task", "confirm"]);
    expect(coming!.glyph).toBe("event");
    expect(coming!.dateBlock).toEqual({ month: "NOV", day: "12" });
    // The block is decoration: the detail says the day in words.
    expect(coming!.detail).toMatch(/^Tomorrow · .* · Great Room$/);
    expect([mine!.dateBlock, waiting!.dateBlock]).toEqual([null, null]);
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
});

describe("activityLinkKind", () => {
  // The kind label follows the shared matcher on every fixture, falling back
  // to the bare host when it names none (#4215).
  const { fixtures } = JSON.parse(
    readFileSync(
      join(__dirname, "../../validation/sign-up-link-fixtures.json"),
      "utf8",
    ),
  ) as { fixtures: { url: string; kind: string | null }[] };
  it.each(fixtures.map((f) => [f.url, f.kind] as const))(
    "labels %s as the shared matcher does (%s)",
    (url, kind) => {
      const host = new URL(url).hostname;
      expect(activityLinkKind({ host, url })).toBe(kind ?? host);
    },
  );

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

describe("activityRowAction (#4402)", () => {
  it("puts the one-press asks on the row, and never Vote or a status", () => {
    const data = activity({
      needs_you: {
        tasks: [task({ id: "mine", title: "Mine" })],
        task_confirmations: [
          task({ id: "done", title: "Done", status: "COMPLETED" }),
          // Proof to look at first: it opens rather than confirming (#4635).
          task({
            id: "proof",
            title: "Proof",
            status: "COMPLETED",
            proof_kind: "photo",
          }),
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
        event({
          id: "zoned",
          name: "Zoned",
          check_in_open: true,
          checked_in: false,
          check_in_needs_location: true,
        }),
        event({ id: "later", name: "Later" }),
      ],
    });
    const rows = allRows(data, new Date("2026-11-12T00:00:00.000Z"));
    const actions = Object.fromEntries(
      rows.map((row) => [row.title, activityRowAction(row)]),
    );
    expect(actions).toEqual({
      Open: "check-in",
      // A zone needs a location the web can't give (#4427): it opens.
      Zoned: null,
      Mine: null,
      Done: "confirm",
      Proof: null,
      "Food bank": "approve",
      "Formal venue?": null,
      Later: null,
    });
    // The phone can supply one, so the zoned event checks in from its row.
    const zoned = rows.find((row) => row.title === "Zoned")!;
    expect(activityRowAction(zoned, { canSupplyLocation: true })).toBe(
      "check-in",
    );
  });

  it("leaves Check in off web's row while the officer's code is required (#4808)", () => {
    const data = activity({
      coming_up: [
        event({
          check_in_open: true,
          checked_in: false,
          check_in_needs_code: true,
        }),
      ],
    });
    const row = allRows(data, new Date("2026-11-12T00:00:00.000Z")).find(
      (each) => each.kind === "event",
    )!;
    expect(activityRowAction(row)).toBeNull();
    // The phone scans, and asks for the code if the press is refused.
    expect(
      activityRowAction(row, { canSupplyLocation: true, canScan: true }),
    ).toBe("check-in");
  });

  it("offers Check in when a read doesn't say whether the code is required", () => {
    const data = activity({
      coming_up: [
        event({
          check_in_open: true,
          checked_in: false,
          check_in_needs_code: undefined,
        }),
      ],
    });
    const row = allRows(data, new Date("2026-11-12T00:00:00.000Z")).find(
      (each) => each.kind === "event",
    )!;
    expect(activityRowAction(row)).toBe("check-in");
  });

  it("treats an event from a read that doesn't say as needing a location", () => {
    const data = activity({
      coming_up: [
        event({
          check_in_open: true,
          checked_in: false,
          check_in_needs_location: undefined,
        }),
      ],
    });
    const row = allRows(data, new Date("2026-11-12T00:00:00.000Z")).find(
      (each) => each.kind === "event",
    )!;
    expect(activityRowAction(row)).toBeNull();
    expect(activityRowAction(row, { canSupplyLocation: true })).toBe(
      "check-in",
    );
  });
});

describe("faces and closing soon (#4402, item 4)", () => {
  const NOW = new Date("2026-11-11T12:00:00.000Z");
  const IN = (minutes: number) =>
    new Date(NOW.getTime() + minutes * 60_000).toISOString();
  const rows = (data: Activity): ActivityRow[] => allRows(data, NOW);
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

describe("review steps (#4693)", () => {
  const waiting = (id: string, title: string) =>
    task({
      id,
      title,
      assignee_id: `member-${id}`,
      status: "COMPLETED",
      stored_status: "COMPLETED",
      point_reward: 10,
    });
  const data = activity({
    needs_you: {
      tasks: [task({ id: "mine", title: "My own task" })],
      task_confirmations: [
        waiting("t1", "Clean his room"),
        waiting("t2", "Kitchen trash"),
      ],
      hours_approvals: [],
      polls: [],
    },
  });

  it("queues the tasks waiting on a sign-off, in the list's order", () => {
    expect(activityReviewQueue(data).map((row) => row.key)).toEqual([
      "needs-confirm:task:t1",
      "needs-confirm:task:t2",
    ]);
  });

  it("finds a task's row for its review push, and nothing for one gone", () => {
    expect(findActivityTaskRow(data, "t2")?.key).toBe("needs-confirm:task:t2");
    expect(findActivityTaskRow(data, "gone")).toBeNull();
  });

  it("finds a task on the member's own list or among those they assigned, the review first", () => {
    const shared = waiting("both", "Assigned and waiting");
    const feed = activity({
      needs_you: {
        tasks: [task({ id: "mine", title: "My own task" })],
        task_confirmations: [shared],
        hours_approvals: [],
        polls: [],
      },
      made_by_you: {
        polls: [],
        tasks: [shared, task({ id: "out", title: "Assigned" })],
        events: [],
      },
    });
    expect(findActivityTaskRow(feed, "mine")?.key).toBe("needs:task:mine");
    expect(findActivityTaskRow(feed, "out")?.key).toBe("made:task:out");
    expect(findActivityTaskRow(feed, "both")?.key).toBe(
      "needs-confirm:task:both",
    );
  });
});
