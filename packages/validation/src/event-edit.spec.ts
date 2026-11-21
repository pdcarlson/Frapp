import { describe, expect, it } from "vitest";
import {
  deleteOffersSeriesChoice,
  eventEditPatch,
  isEmptyEventPatch,
  isInSeries,
  leavesAfterSave,
  repeatEditSeriesOf,
  saveRequestFor,
  saveScopeFor,
  seriesRuleOf,
  seriesStartsIn,
  type EventEditStored,
  type EventEditTarget,
  type SeriesEventFields,
} from "./event-edit";

const NOW = new Date("2026-11-08T22:00:00Z");

const EVENT: SeriesEventFields = {
  id: "evt-1",
  start_time: "2026-11-09T23:45:00.000Z",
  end_time: "2026-11-10T01:15:00.000Z",
  recurrence_rule: null,
  parent_event_id: null,
};

const single: EventEditTarget = {
  event: EVENT,
  seriesRule: null,
  parent: null,
};

const PARENT = {
  id: "evt-parent",
  start_time: "2026-09-07T22:45:00.000Z",
  end_time: "2026-09-08T00:15:00.000Z",
};
const occurrence: EventEditTarget = {
  event: { ...EVENT, parent_event_id: PARENT.id },
  seriesRule: "WEEKLY",
  parent: PARENT,
};

const STORED: EventEditStored = {
  name: "Chapter",
  start_time: EVENT.start_time,
  end_time: EVENT.end_time,
  location: "Sanctuary ",
  description: null,
  notes: "Bring dues",
  point_value: 10,
  check_in_opens_minutes: 10,
  attendance: {
    is_mandatory: true,
    others_invited: true,
    required_role_ids: [],
    optional_role_ids: [],
    excluded_role_ids: [],
  },
  event_type_id: null,
  check_in_zone: [
    { lat: 1, lng: 2 },
    { lat: 3, lng: 4 },
    { lat: 5, lng: 6 },
  ],
  check_in_zone_name: "Hall",
};

/** Everything a full form would hold, unchanged. */
const UNCHANGED = {
  name: "Chapter",
  start: new Date(EVENT.start_time),
  end: new Date(EVENT.end_time),
  location: "Sanctuary",
  description: "",
  notes: "Bring dues",
  point_value: 10,
  check_in_opens_minutes: 10,
  attendance: {
    is_mandatory: true,
    others_invited: true,
    required_role_ids: [],
    optional_role_ids: [],
    excluded_role_ids: [],
  },
  event_type_id: null,
  recurrence_rule: "WEEKLY",
  check_in_zone: [
    { lat: 1, lng: 2 },
    { lat: 3, lng: 4 },
    { lat: 5, lng: 6 },
  ],
  check_in_zone_name: "Hall",
};

describe("eventEditPatch", () => {
  it("sends nothing for an untouched form", () => {
    expect(isEmptyEventPatch(eventEditPatch(STORED, "WEEKLY", UNCHANGED))).toBe(
      true,
    );
  });

  it("sends a rename alone, with no time or location to page the chapter", () => {
    expect(
      eventEditPatch(STORED, "WEEKLY", { ...UNCHANGED, name: " Renamed " }),
    ).toEqual({ name: "Renamed" });
  });

  it("sends a cleared field as empty, so it clears", () => {
    expect(
      eventEditPatch(STORED, "WEEKLY", { ...UNCHANGED, notes: "  " }),
    ).toEqual({ notes: "" });
  });

  it("sends the rule only when it changed", () => {
    expect(
      eventEditPatch(STORED, "WEEKLY", { ...UNCHANGED, recurrence_rule: null }),
    ).toEqual({ recurrence_rule: null });
  });

  it("sends all five attendance fields together when one changed", () => {
    const attendance = { ...UNCHANGED.attendance, is_mandatory: false };
    expect(
      eventEditPatch(STORED, "WEEKLY", { ...UNCHANGED, attendance }),
    ).toEqual(attendance);
  });

  it("reads a reordered zone as a change and an emptied one as a clear", () => {
    const [a, b, c] = UNCHANGED.check_in_zone;
    expect(
      eventEditPatch(STORED, "WEEKLY", {
        ...UNCHANGED,
        check_in_zone: [b!, a!, c!],
      }),
    ).toEqual({ check_in_zone: [b, a, c] });
    expect(
      eventEditPatch(STORED, "WEEKLY", {
        ...UNCHANGED,
        check_in_zone: [],
        check_in_zone_name: "",
      }),
    ).toEqual({ check_in_zone: [], check_in_zone_name: "" });
  });

  it("never sends a field the form leaves out", () => {
    expect(eventEditPatch(STORED, "WEEKLY", { name: "Chapter" })).toEqual({});
  });
});

describe("saveScopeFor", () => {
  it("asks for an event in a series", () => {
    expect(saveScopeFor(occurrence, { name: "x" }, NOW)).toBe("ask");
    const head = {
      ...single,
      event: { ...EVENT, recurrence_rule: "WEEKLY" },
      seriesRule: "WEEKLY" as const,
    };
    expect(saveScopeFor(head, { name: "x" }, NOW)).toBe("ask");
  });

  it("doesn't ask for a one-time event", () => {
    expect(saveScopeFor(single, { name: "x" }, NOW)).toBe("instance");
  });

  it("doesn't offer All upcoming for an event already under way", () => {
    // The server never edits a started event with the series, so the choice
    // would skip the event on screen.
    const during = new Date("2026-11-10T00:00:00Z");
    expect(saveScopeFor(occurrence, { name: "x" }, during)).toBe("instance");
  });

  it("doesn't offer All upcoming when the series parent couldn't be read", () => {
    const orphan = { ...occurrence, parent: null };
    expect(saveScopeFor(orphan, { name: "x" }, NOW)).toBe("instance");
  });

  it("treats a Repeat change as a series change", () => {
    expect(saveScopeFor(single, { recurrence_rule: "WEEKLY" }, NOW)).toBe(
      "series",
    );
    expect(saveScopeFor(occurrence, { recurrence_rule: null }, NOW)).toBe(
      "series",
    );
  });
});

describe("saveRequestFor", () => {
  it("sends this-event edits to the event", () => {
    expect(saveRequestFor(occurrence, { name: "x" }, "instance")).toEqual({
      id: "evt-1",
      scope: "instance",
      body: { name: "x" },
    });
  });

  it("moves the whole series by the same shift, through the parent", () => {
    // 6:45 PM → 7:00 PM on this occurrence, and 15 minutes longer.
    const request = saveRequestFor(
      occurrence,
      {
        name: "Chapter",
        start_time: "2026-11-10T00:00:00.000Z",
        end_time: "2026-11-10T01:45:00.000Z",
      },
      "series",
    );
    expect(request).toEqual({
      id: "evt-parent",
      scope: "series",
      body: {
        name: "Chapter",
        start_time: "2026-09-07T23:00:00.000Z",
        end_time: "2026-09-08T00:45:00.000Z",
      },
    });
  });

  it("sends a series rename to the parent without times", () => {
    expect(saveRequestFor(occurrence, { name: "x" }, "series")).toEqual({
      id: "evt-parent",
      scope: "series",
      body: { name: "x" },
    });
  });

  it("falls back to the occurrence when its parent can't be read", () => {
    const orphan = { ...occurrence, parent: null };
    expect(saveRequestFor(orphan, { name: "x" }, "series").id).toBe("evt-1");
  });
});

describe("leavesAfterSave", () => {
  it("stays for a this-event edit", () => {
    const request = saveRequestFor(occurrence, { name: "x" }, "instance");
    expect(leavesAfterSave(request, occurrence, "evt-1")).toBe(false);
  });

  it("stays for a series rename, patched in place", () => {
    const request = saveRequestFor(occurrence, { name: "x" }, "series");
    expect(leavesAfterSave(request, occurrence, "evt-parent")).toBe(false);
  });

  it("leaves when a series move rebuilds the occurrence on screen", () => {
    const request = saveRequestFor(
      occurrence,
      { start_time: "2026-11-10T00:00:00.000Z" },
      "series",
    );
    expect(leavesAfterSave(request, occurrence, "evt-parent")).toBe(true);
  });

  it("leaves when a started series moves onto its next event", () => {
    const head = { ...single, seriesRule: "WEEKLY" as const };
    const request = saveRequestFor(head, { name: "x" }, "series");
    expect(leavesAfterSave(request, head, "evt-next")).toBe(true);
    expect(leavesAfterSave(request, head, "evt-1")).toBe(false);
  });
});

describe("seriesRuleOf", () => {
  it("reads a parent's own rule and an occurrence's parent's", () => {
    expect(seriesRuleOf({ ...EVENT, recurrence_rule: "MONTHLY" }, null)).toBe(
      "MONTHLY",
    );
    expect(
      seriesRuleOf(occurrence.event, { recurrence_rule: "BIWEEKLY" }),
    ).toBe("BIWEEKLY");
    expect(seriesRuleOf(occurrence.event, null)).toBeNull();
  });
});

describe("isInSeries", () => {
  it("counts a head carrying a structured rule as a series", () => {
    const structured = {
      ...EVENT,
      recurrence_rule:
        "FREQ=WEEKLY;INTERVAL=1;BYDAY=MO;COUNT=8;TZID=America/New_York",
    };
    expect(isInSeries(structured)).toBe(true);
    // The Repeat control reads it (#4488).
    expect(seriesRuleOf(structured, null)).toBe(structured.recurrence_rule);
    expect(isInSeries({ ...EVENT, recurrence_rule: null })).toBe(false);
  });
});

describe("deleteOffersSeriesChoice", () => {
  it("asks for an upcoming event in a series, even without its parent", () => {
    expect(deleteOffersSeriesChoice(occurrence.event, NOW)).toBe(true);
  });

  it("doesn't ask for a one-time event or one under way", () => {
    expect(deleteOffersSeriesChoice(EVENT, NOW)).toBe(false);
    const during = new Date("2026-11-10T00:00:00Z");
    expect(deleteOffersSeriesChoice(occurrence.event, during)).toBe(false);
  });
});

// #4746: a Repeat change on a started series anchors on its real next meeting.
describe("the series' real next meeting", () => {
  const head: SeriesEventFields = {
    id: "head-1",
    start_time: "2027-02-26T04:30:00.000Z",
    end_time: "2027-02-26T05:30:00.000Z",
    parent_event_id: null,
    recurrence_rule: "WEEKLY",
  };
  const child = (id: string, start: string, parent = "head-1") => ({
    id,
    start_time: start,
    end_time: start,
    parent_event_id: parent,
    recurrence_rule: null,
  });
  const list = [
    head,
    child("c-1", "2027-03-12T04:30:00.000Z"),
    child("c-3", "2027-03-26T04:30:00.000Z"),
    child("c-2", "2027-03-19T04:30:00.000Z"),
    child("other", "2027-03-16T04:30:00.000Z", "head-2"),
    { id: "broken", parent_event_id: "head-1" },
    null,
  ];
  const now = new Date("2027-03-15T12:00:00Z");

  it("collects the starts of the series' own rows, from the head or a child", () => {
    const starts = [
      "2027-03-12T04:30:00.000Z",
      "2027-03-26T04:30:00.000Z",
      "2027-03-19T04:30:00.000Z",
    ];
    const target = { event: head, parent: null, seriesRule: "WEEKLY" };
    expect(seriesStartsIn(target, list)).toEqual(starts);
    const fromChild = {
      event: child("c-2", "2027-03-19T04:30:00.000Z"),
      parent: head,
      seriesRule: "WEEKLY",
    };
    expect(seriesStartsIn(fromChild, list)).toEqual(starts);
  });

  it("holds nothing without a list or a series", () => {
    const target = { event: head, parent: null, seriesRule: "WEEKLY" };
    expect(seriesStartsIn(target, undefined)).toBeUndefined();
    expect(
      seriesStartsIn({ ...target, seriesRule: null }, list),
    ).toBeUndefined();
  });

  it("hands the earliest row after now to the anchor", () => {
    const target: EventEditTarget = {
      event: head,
      parent: null,
      seriesRule: "WEEKLY",
    };
    const withRows = {
      ...target,
      seriesStarts: seriesStartsIn(target, list),
    };
    const start = new Date(head.start_time);
    expect(repeatEditSeriesOf(withRows, start, now).nextStart).toEqual(
      new Date("2027-03-19T04:30:00.000Z"),
    );
    expect(repeatEditSeriesOf(target, start, now).nextStart).toBeNull();
  });
});
