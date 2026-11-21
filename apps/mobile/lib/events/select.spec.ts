import { describe, expect, it } from "vitest";
import {
  selectAllEventRows,
  selectEventDetail,
  withoutMeetingLists,
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
      selectMyAttendance({
        attendance: { status: "EXCUSED", check_in_time: at },
      }),
    ).toEqual({ status: "EXCUSED", checkedInAt: null });
    expect(
      selectMyAttendance({
        attendance: { status: "PRESENT", check_in_time: null },
      }),
    ).toEqual({ status: "PRESENT", checkedInAt: null });
  });

  it("is null with no row, or one it can't read", () => {
    expect(selectMyAttendance({ attendance: null })).toBeNull();
    expect(selectMyAttendance({ attendance: { status: "GONE" } })).toBeNull();
    expect(selectMyAttendance(undefined)).toBeNull();
  });
});

describe("selectSeriesOccurrences", () => {
  const now = new Date(2026, 10, 9, 9, 0);
  const at = (
    id: string,
    day: number,
    parent: string | null,
    rule: string | null = null,
  ) => ({
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
    expect(
      selectSeriesOccurrences(selectAllEventRows(data), c1!, now).map(
        (e) => e.id,
      ),
    ).toEqual(["c2", "c3"]);
  });

  it("reaches the children from the head", () => {
    const head = selectAllEventRows(data)[0]!;
    expect(
      selectSeriesOccurrences(selectAllEventRows(data), head, now).map(
        (e) => e.id,
      ),
    ).toEqual(["c1", "c2", "c3"]);
  });

  it("is empty for a one-time event", () => {
    const other = selectAllEventRows(data).find((e) => e.id === "other")!;
    expect(
      selectSeriesOccurrences(selectAllEventRows(data), other, now),
    ).toEqual([]);
  });
});

describe("withoutMeetingLists (#4934)", () => {
  it("keys the edit sheet on everything but the lists saved in place", () => {
    const read = { id: "e1", name: "Chapter", notes: "n" };
    const checkedOff = {
      ...read,
      agenda: [{ id: "a", text: "Report", done: true }],
      attachments: [],
    };
    expect(JSON.stringify(withoutMeetingLists(checkedOff))).toBe(
      JSON.stringify(
        withoutMeetingLists({ ...read, agenda: [], attachments: [] }),
      ),
    );
    expect(withoutMeetingLists(checkedOff)).toEqual(read);
    expect(withoutMeetingLists(undefined)).toBeUndefined();
  });
});
