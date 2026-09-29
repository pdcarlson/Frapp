import { describe, expect, it } from "vitest";
import {
  authorGroupingKey,
  calendarDayKey,
  dayDividerLabel,
  decorateThread,
  GROUPING_WINDOW_MS,
  type GroupableMessage,
  type GroupableRow,
} from "./grouping";

/** A local wall-clock time, so day boundaries hold in whatever zone CI runs. */
function at(day: number, hour: number, minute = 0, second = 0): string {
  return new Date(2026, 8, day, hour, minute, second).toISOString();
}

function msg(overrides: Partial<GroupableMessage> = {}): GroupableMessage {
  return {
    sender_id: "u1",
    created_at: at(28, 17, 15),
    kind: "text",
    reply_to_id: null,
    is_deleted: false,
    ...overrides,
  };
}

function visible(message: GroupableMessage): GroupableRow {
  return { message, visibility: "visible" };
}

/** `startsRun` for each row, in order. */
function runs(rows: GroupableRow[]): boolean[] {
  return decorateThread(rows).map((entry) => entry.startsRun);
}

describe("decorateThread — runs", () => {
  it("starts a run on the first row", () => {
    expect(runs([visible(msg())])).toEqual([true]);
  });

  it("joins the same author within the window", () => {
    expect(
      runs([
        visible(msg({ created_at: at(28, 17, 15) })),
        visible(msg({ created_at: at(28, 17, 16) })),
        visible(msg({ created_at: at(28, 17, 19) })),
      ]),
    ).toEqual([true, false, false]);
  });

  it("measures the window from the previous row, not the run's first", () => {
    // 17:15 → 17:19 → 17:23: each gap is 4 minutes, the run spans 8.
    expect(
      runs([
        visible(msg({ created_at: at(28, 17, 15) })),
        visible(msg({ created_at: at(28, 17, 19) })),
        visible(msg({ created_at: at(28, 17, 23) })),
      ]),
    ).toEqual([true, false, false]);
  });

  it("breaks on a sender change", () => {
    expect(
      runs([
        visible(msg({ sender_id: "u1" })),
        visible(msg({ sender_id: "u2" })),
        visible(msg({ sender_id: "u1" })),
      ]),
    ).toEqual([true, true, true]);
  });

  it("breaks at exactly the window, and joins just under it", () => {
    const first = new Date(at(28, 17, 15));
    const under = new Date(first.getTime() + GROUPING_WINDOW_MS - 1000);
    const exact = new Date(under.getTime() + GROUPING_WINDOW_MS);
    expect(
      runs([
        visible(msg({ created_at: first.toISOString() })),
        visible(msg({ created_at: under.toISOString() })),
        visible(msg({ created_at: exact.toISOString() })),
      ]),
    ).toEqual([true, false, true]);
  });

  it("keeps the window at five minutes, the value both surfaces share", () => {
    expect(GROUPING_WINDOW_MS).toBe(5 * 60 * 1000);
  });

  it("joins a row stamped a moment before the one above (clock skew)", () => {
    expect(
      runs([
        visible(msg({ created_at: at(28, 17, 15, 30) })),
        visible(msg({ created_at: at(28, 17, 15, 29) })),
      ]),
    ).toEqual([true, false]);
  });

  it("breaks on a day change even inside the window", () => {
    const rows = [
      visible(msg({ created_at: at(28, 23, 59) })),
      visible(msg({ created_at: at(29, 0, 1) })),
    ];
    const decorated = decorateThread(rows);
    expect(decorated.map((entry) => entry.startsDay)).toEqual([true, true]);
    expect(decorated.map((entry) => entry.startsRun)).toEqual([true, true]);
  });

  it("breaks on the same day of the month in another month", () => {
    const rows = [
      visible(msg({ created_at: new Date(2026, 8, 28, 17, 15).toISOString() })),
      visible(msg({ created_at: new Date(2026, 9, 28, 17, 15).toISOString() })),
    ];
    expect(decorateThread(rows).map((entry) => entry.startsDay)).toEqual([
      true,
      true,
    ]);
  });

  it("marks only the first row of each day as starting one", () => {
    expect(
      decorateThread([
        visible(msg({ created_at: at(28, 9, 0) })),
        visible(msg({ created_at: at(28, 21, 0) })),
        visible(msg({ created_at: at(29, 9, 0) })),
      ]).map((entry) => entry.startsDay),
    ).toEqual([true, false, true]);
  });

  it("starts a run on a reply from the same author", () => {
    expect(
      runs([
        visible(msg()),
        visible(msg({ reply_to_id: "m0", created_at: at(28, 17, 16) })),
      ]),
    ).toEqual([true, true]);
  });

  it("starts a run on a card, and after one", () => {
    expect(
      runs([
        visible(msg({ created_at: at(28, 17, 15) })),
        visible(msg({ kind: "poll", created_at: at(28, 17, 16) })),
        visible(msg({ created_at: at(28, 17, 17) })),
      ]),
    ).toEqual([true, true, true]);
  });

  it("groups the imported kind like text", () => {
    expect(
      runs([
        visible(msg({ kind: "imported", created_at: at(28, 17, 15) })),
        visible(msg({ kind: null, created_at: at(28, 17, 16) })),
      ]),
    ).toEqual([true, false]);
  });

  it("starts a run after a deleted message", () => {
    expect(
      runs([
        visible(msg({ is_deleted: true })),
        visible(msg({ created_at: at(28, 17, 16) })),
      ]),
    ).toEqual([true, true]);
  });

  it("starts a run after a tombstone", () => {
    expect(
      runs([
        { message: msg(), visibility: "tombstone" },
        visible(msg({ created_at: at(28, 17, 16) })),
      ]),
    ).toEqual([true, true]);
  });

  it("does not merge two different imported authors", () => {
    expect(
      runs([
        visible(msg({ sender_id: null, author_external_id: "1", author_name: "Ada" })),
        visible(
          msg({
            sender_id: null,
            author_external_id: "2",
            author_name: "Grace",
            created_at: at(28, 17, 16),
          }),
        ),
      ]),
    ).toEqual([true, true]);
  });

  it("starts a run, but draws no divider, when a timestamp cannot be read", () => {
    const decorated = decorateThread([
      visible(msg()),
      visible(msg({ created_at: "not a date" })),
      visible(msg({ created_at: at(28, 17, 16) })),
    ]);
    expect(decorated.map((entry) => entry.startsRun)).toEqual([
      true,
      true,
      true,
    ]);
    // An unreadable day has no label to print, so it gets no divider; the row
    // after it is on the first row's day again, which it did not follow.
    expect(decorated.map((entry) => entry.startsDay)).toEqual([
      true,
      false,
      true,
    ]);
  });
});

describe("authorGroupingKey", () => {
  it("groups two messages from the same member", () => {
    expect(authorGroupingKey({ sender_id: "u1" })).toBe(
      authorGroupingKey({ sender_id: "u1" }),
    );
  });

  it("does NOT group two different imported authors", () => {
    // The regression this exists for: comparing `sender_id` directly, `null ===
    // null` is true, so an imported channel where twenty Discord members spoke
    // in turn collapsed into one block under one name.
    const a = { sender_id: null, author_name: "Ada", author_external_id: "1" };
    const b = { sender_id: null, author_name: "Grace", author_external_id: "2" };
    expect(authorGroupingKey(a)).not.toBe(authorGroupingKey(b));
  });

  it("separates a Frapp uuid from a source-system id that reads the same", () => {
    expect(authorGroupingKey({ sender_id: "1234" })).not.toBe(
      authorGroupingKey({ sender_id: null, author_external_id: "1234" }),
    );
  });

  it("keeps two imported authors apart when they share a display name", () => {
    // Two Discord members both called "Chris" are two people.
    expect(
      authorGroupingKey({
        sender_id: null,
        author_name: "Chris",
        author_external_id: "1",
      }),
    ).not.toBe(
      authorGroupingKey({
        sender_id: null,
        author_name: "Chris",
        author_external_id: "2",
      }),
    );
  });

  it("falls back to the name when an imported row carries no external id", () => {
    expect(
      authorGroupingKey({ sender_id: null, author_name: "Ada" }),
    ).not.toBe(authorGroupingKey({ sender_id: null, author_name: "Grace" }));
  });

  it("reads a nameless, idless author as unknown", () => {
    expect(authorGroupingKey({ sender_id: null, author_name: "  " })).toBe(
      "unknown",
    );
  });
});

describe("day dividers", () => {
  const now = new Date(2026, 8, 29, 12, 0);

  it("labels today and yesterday by the local calendar day", () => {
    expect(dayDividerLabel(at(29, 0, 5), now)).toBe("Today");
    expect(dayDividerLabel(at(28, 23, 55), now)).toBe("Yesterday");
  });

  it("labels older days with the weekday and date, never a time", () => {
    const label = dayDividerLabel(at(20, 17, 15), now);
    expect(label).not.toBe("Yesterday");
    expect(label).toContain("20");
    expect(label).not.toMatch(/\d:\d\d/);
  });

  it("adds the year to a day in another year, and only then", () => {
    const lastYear = new Date(2025, 2, 3, 9, 0).toISOString();
    expect(dayDividerLabel(lastYear, now)).toContain("2025");
    expect(dayDividerLabel(at(20, 17, 15), now)).not.toContain("2026");
  });

  it("prints nothing for an unreadable timestamp", () => {
    expect(dayDividerLabel("nope", now)).toBe("");
    expect(calendarDayKey("nope")).toBeNull();
  });
});
