import { describe, expect, it } from "vitest";
import {
  selectAllEventRows,
  selectEventDetail,
  selectEventList,
  selectMyAttendance,
  selectSeriesOccurrences,
} from "./select";

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: "e-1",
    name: "Chapter Meeting",
    location: "Great Room",
    start_time: "2026-09-01T20:00:00.000Z",
    end_time: "2026-09-01T21:00:00.000Z",
    point_value: 5,
    is_mandatory: true,
    description: "Bring your dues.",
    notes: "Motion to approve budget passed 12-0.",
    check_in_zone_name: null,
    check_in_zone: null,
    ...overrides,
  };
}

describe("selectEventDetail — notes", () => {
  it("carries meeting minutes through when present", () => {
    const detail = selectEventDetail(event());
    expect(detail?.notes).toBe("Motion to approve budget passed 12-0.");
  });

  it("is null when the event has no notes, rather than an empty string", () => {
    expect(selectEventDetail(event({ notes: null }))?.notes).toBeNull();
    expect(selectEventDetail(event({ notes: "" }))?.notes).toBeNull();
  });

  // A whitespace-only value must read as absent, or the section renders with
  // a label and an invisible body.
  it("is null for a whitespace-only value", () => {
    expect(selectEventDetail(event({ notes: "   " }))?.notes).toBeNull();
  });

  it("does not require notes for an otherwise-valid event to resolve", () => {
    const detail = selectEventDetail(event({ notes: undefined }));
    expect(detail).not.toBeNull();
    expect(detail?.notes).toBeNull();
  });
});

describe("selectEventDetail — recurrence", () => {
  it("carries the series rule and parent id through when present", () => {
    const detail = selectEventDetail(
      event({ recurrence_rule: "WEEKLY", parent_event_id: "e-parent" }),
    );
    expect(detail?.recurrence_rule).toBe("WEEKLY");
    expect(detail?.parent_event_id).toBe("e-parent");
  });

  // A one-off carries neither. Both must read as null rather than undefined:
  // the edit flow branches on `parent_event_id` to decide whether the event
  // belongs to a series at all.
  it("is null for a one-off event, including when the keys are absent", () => {
    const detail = selectEventDetail(event());
    expect(detail?.recurrence_rule).toBeNull();
    expect(detail?.parent_event_id).toBeNull();

    const explicit = selectEventDetail(
      event({ recurrence_rule: null, parent_event_id: null }),
    );
    expect(explicit?.recurrence_rule).toBeNull();
    expect(explicit?.parent_event_id).toBeNull();
  });

  it("does not require recurrence fields for an event to resolve", () => {
    expect(selectEventDetail(event())).not.toBeNull();
  });
});

describe("selectEventDetail — check-in lead", () => {
  it("keeps the event's lead and defaults a row without one", () => {
    expect(
      selectEventDetail(event({ check_in_opens_minutes: 25 }))
        ?.check_in_opens_minutes,
    ).toBe(25);
    expect(selectEventDetail(event())?.check_in_opens_minutes).toBe(10);
  });
});

describe("selectMyAttendance", () => {
  const at = "2026-11-07T00:52:00.000Z";

  it("reads a PRESENT or LATE row's check-in time", () => {
    for (const status of ["PRESENT", "LATE"]) {
      expect(
        selectMyAttendance({ attendance: { status, check_in_time: at } }),
      ).toEqual({ status, checkedInAt: new Date(at) });
    }
  });

  it("keeps an officer's mark, with no check-in", () => {
    expect(
      selectMyAttendance({ attendance: { status: "EXCUSED", check_in_time: at } }),
    ).toEqual({ status: "EXCUSED", checkedInAt: null });
    expect(
      selectMyAttendance({ attendance: { status: "PRESENT", check_in_time: null } }),
    ).toEqual({ status: "PRESENT", checkedInAt: null });
  });

  it("is null with no row, or one it can't read", () => {
    expect(selectMyAttendance({ attendance: null })).toBeNull();
    expect(selectMyAttendance({ attendance: { status: "GONE" } })).toBeNull();
    expect(selectMyAttendance(undefined)).toBeNull();
  });
});

/**
 * #3707 / #3823: a repeating series is one row, the list holds today through
 * the next two weeks under day headings, and everything after waits in Later.
 * Local wall-clock times, so the day split holds wherever the suite runs.
 */
describe("selectEventList", () => {
  // Monday Nov 9, 2026, 9:00 AM.
  const now = new Date(2026, 10, 9, 9, 0);
  const local = (day: number, hour = 18, month = 11) =>
    new Date(2026, month - 1, day, hour).toISOString();
  const row = (id: string, day: number, extra: object = {}) => ({
    id,
    name: id,
    location: null,
    start_time: local(day),
    end_time: local(day, 19),
    point_value: null,
    ...extra,
  });
  /** "Chapter" every Sunday from Nov 8, as the API materializes it. */
  const chapter = Array.from({ length: 13 }, (_, index) =>
    row(index === 0 ? "head" : `chapter-${index}`, 8 + index * 7, {
      name: "Chapter",
      recurrence_rule: index === 0 ? "WEEKLY" : null,
      parent_event_id: index === 0 ? null : "head",
    }),
  );

  const flatten = (groups: ReturnType<typeof selectEventList>["soon"]) =>
    groups.flatMap((group) =>
      group.entries.map((entry) => `${group.heading}: ${entry.event.name}`),
    );

  it("draws a weekly series once, as its next occurrence, labelled", () => {
    const { soon, later } = selectEventList(chapter, now);
    expect(flatten(soon)).toEqual(["Sunday: Chapter"]);
    expect(soon[0]!.entries[0]!.cadence).toBe("Every Sunday");
    expect(soon[0]!.entries[0]!.event.id).toBe("chapter-1");
    expect(later).toEqual([]);
  });

  it("writes day headings out and splits at the end of the 14th day", () => {
    const { soon, later } = selectEventList(
      [
        row("today", 9),
        row("tomorrow", 10),
        row("thursday", 12),
        row("next week", 17),
        row("day 14", 23),
        row("day 15", 24),
      ],
      now,
    );
    expect(flatten(soon)).toEqual([
      "Today: today",
      "Tomorrow: tomorrow",
      "Thursday: thursday",
      "November 17: next week",
      "November 23: day 14",
    ]);
    expect(flatten(later)).toEqual(["November 24: day 15"]);
    expect(soon.every((group) => group.entries.every((e) => e.cadence === null))).toBe(true);
  });

  it("groups two events on one day under one heading", () => {
    const { soon } = selectEventList([row("a", 10, { start_time: local(10, 12) }), row("b", 10)], now);
    expect(soon).toHaveLength(1);
    expect(soon[0]!.entries.map((entry) => entry.event.id)).toEqual(["a", "b"]);
  });

  it("puts a series whose next meeting is past the horizon under Later, once", () => {
    const monthly = [0, 1, 2].map((index) =>
      row(index === 0 ? "dues" : `dues-${index}`, 28, {
        start_time: local(28, 18, 11 + index),
        end_time: local(28, 19, 11 + index),
        name: "Dues night",
        recurrence_rule: index === 0 ? "MONTHLY" : null,
        parent_event_id: index === 0 ? null : "dues",
      }),
    );
    const { soon, later } = selectEventList(monthly, now);
    expect(soon).toEqual([]);
    expect(flatten(later)).toEqual(["November 28: Dues night"]);
    expect(later[0]!.entries[0]!.cadence).toBe("Every month on the 28th");
  });

  it("shows a series meeting that is under way as the series' row, not twice", () => {
    // Sunday Nov 15, 6:05 PM: chapter-1 started five minutes ago.
    const during = new Date(2026, 10, 15, 18, 5);
    const { soon } = selectEventList(chapter, during);
    const rows = soon.flatMap((group) => group.entries);
    expect(rows.map((entry) => entry.event.id)).toEqual(["chapter-1"]);
    expect(rows[0]!.cadence).toBe("Every Sunday");
  });
});

describe("selectSeriesOccurrences", () => {
  const now = new Date(2026, 10, 9, 9, 0);
  const at = (id: string, day: number, parent: string | null, rule: string | null = null) => ({
    id,
    name: "Chapter",
    start_time: new Date(2026, 10, day, 18).toISOString(),
    end_time: new Date(2026, 10, day, 19).toISOString(),
    recurrence_rule: rule,
    parent_event_id: parent,
  });
  const data = [
    at("head", 8, null, "WEEKLY"),
    at("c1", 15, "head"),
    at("c2", 22, "head"),
    at("c3", 29, "head"),
    { ...at("other", 16, null), name: "Social" },
  ];

  it("lists the series' other upcoming dates, soonest first", () => {
    const [, c1] = selectAllEventRows(data);
    expect(c1!.id).toBe("c1");
    expect(selectSeriesOccurrences(data, c1!, now).map((e) => e.id)).toEqual(["c2", "c3"]);
  });

  it("reaches the children from the head", () => {
    const head = selectAllEventRows(data)[0]!;
    expect(selectSeriesOccurrences(data, head, now).map((e) => e.id)).toEqual(["c1", "c2", "c3"]);
  });

  it("is empty for a one-time event", () => {
    const other = selectAllEventRows(data).find((e) => e.id === "other")!;
    expect(selectSeriesOccurrences(data, other, now)).toEqual([]);
  });
});
