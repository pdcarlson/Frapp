import { describe, expect, it } from "vitest";
import {
  collapseSeries,
  eventSeriesKey,
  horizonEnd,
  isSeriesEvent,
  seriesCadenceLabel,
  ruleTokenLabel,
  seriesHeadOf,
  splitByHorizon,
} from "./event-series";

type Row = {
  id: string;
  name: string;
  start_time: string;
  recurrence_rule: string | null;
  parent_event_id: string | null;
};

const NOW = Date.parse("2026-11-09T12:00:00Z");

function weekly(count: number, firstStart: string): Row[] {
  const first = Date.parse(firstStart);
  return Array.from({ length: count }, (_, i) => ({
    id: i === 0 ? "head" : `child-${i}`,
    name: "Chapter",
    start_time: new Date(first + i * 7 * 24 * 3600_000).toISOString(),
    recurrence_rule: i === 0 ? "WEEKLY" : null,
    parent_event_id: i === 0 ? null : "head",
  }));
}

describe("eventSeriesKey", () => {
  it("keys a head by its id and a generated occurrence by its parent", () => {
    const [head, child] = weekly(2, "2026-11-15T23:48:00Z");
    expect(eventSeriesKey(head!)).toBe("head");
    expect(eventSeriesKey(child!)).toBe("head");
    expect(isSeriesEvent(child!)).toBe(true);
  });

  it("has no key for a one-time or detached event", () => {
    expect(
      eventSeriesKey({ id: "x", recurrence_rule: null, parent_event_id: null }),
    ).toBeNull();
    expect(eventSeriesKey({ id: "x", recurrence_rule: "" })).toBeNull();
  });

  it("finds the head and its rule", () => {
    const rows = weekly(3, "2026-11-15T23:48:00Z");
    expect(seriesHeadOf("head", rows)?.recurrence_rule).toBe("WEEKLY");
    expect(seriesHeadOf("missing", rows)).toBeNull();
  });
});

describe("collapseSeries", () => {
  it("shows a 13-meeting series once, as its next meeting", () => {
    const rows = weekly(13, "2026-11-15T23:48:00Z");
    const entries = collapseSeries(rows, NOW);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.event.id).toBe("head");
    expect(entries[0]!.series).toHaveLength(13);
  });

  it("keeps meetings that already happened as their own rows", () => {
    // Head two weeks ago, so head and child-1 are past.
    const rows = weekly(5, "2026-10-26T23:48:00Z");
    const entries = collapseSeries(rows, NOW);
    expect(entries.map((e) => e.event.id)).toEqual([
      "head",
      "child-1",
      "child-2",
    ]);
    expect(entries[0]!.series).toBeNull();
    expect(entries[1]!.series).toBeNull();
    expect(entries[2]!.series?.map((e) => e.id)).toEqual([
      "child-2",
      "child-3",
      "child-4",
    ]);
  });

  it("leaves one-time events alone and keeps order", () => {
    const solo: Row = {
      id: "solo",
      name: "Formal",
      start_time: "2026-11-10T02:00:00Z",
      recurrence_rule: null,
      parent_event_id: null,
    };
    const rows = [solo, ...weekly(3, "2026-11-15T23:48:00Z")];
    const entries = collapseSeries(rows, NOW);
    expect(entries.map((e) => e.event.id)).toEqual(["solo", "head"]);
    expect(entries[0]!.series).toBeNull();
  });

  it("picks the soonest occurrence even when the input is unsorted", () => {
    const rows = weekly(3, "2026-11-15T23:48:00Z").reverse();
    const entries = collapseSeries(rows, NOW);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.event.id).toBe("head");
  });
});

describe("splitByHorizon", () => {
  it("holds today through the end of the fourteenth day after it", () => {
    const end = new Date(horizonEnd(NOW));
    expect(end.getHours()).toBe(0);
    const today = new Date(NOW);
    today.setHours(0, 0, 0, 0);
    expect(Math.round((end.getTime() - today.getTime()) / 86_400_000)).toBe(15);
  });

  it("puts what starts past the horizon behind Later", () => {
    const end = horizonEnd(NOW);
    const at = (ms: number) => ({
      event: { id: String(ms), start_time: new Date(ms).toISOString() },
      series: null,
    });
    const { soon, later } = splitByHorizon(
      [at(NOW + 3600_000), at(end - 1), at(end), at(end + 86_400_000)],
      NOW,
    );
    expect(soon).toHaveLength(2);
    expect(later).toHaveLength(2);
  });

  it("keeps an unreadable start in view", () => {
    const { soon } = splitByHorizon(
      [{ event: { id: "x", start_time: "nope" }, series: null }],
      NOW,
    );
    expect(soon).toHaveLength(1);
  });
});

describe("seriesCadenceLabel", () => {
  // Built from local parts so the weekday holds in any test zone.
  const sunday = new Date(2026, 10, 15, 18, 48).toISOString();
  it("says how the series repeats", () => {
    expect(seriesCadenceLabel("WEEKLY", sunday)).toBe("Every Sunday");
    expect(seriesCadenceLabel("BIWEEKLY", sunday)).toBe("Every other Sunday");
    expect(seriesCadenceLabel("MONTHLY", sunday)).toBe(
      "Every month on the 15th",
    );
    expect(
      seriesCadenceLabel("MONTHLY", new Date(2026, 10, 2, 18).toISOString()),
    ).toBe("Every month on the 2nd");
    expect(
      seriesCadenceLabel("MONTHLY", new Date(2026, 10, 11, 18).toISOString()),
    ).toBe("Every month on the 11th");
  });

  it("names the day a monthly series meets on, not a clamped or moved meeting's", () => {
    const on = (month: number, day: number) =>
      new Date(2027, month, day, 18).toISOString();
    // On the 31st; the API puts February's meeting on the 28th, and April's
    // on the 30th. A promoted head on Feb 28 doesn't move the rule either.
    const clamped = [on(1, 28), on(2, 31), on(3, 30), on(4, 31)];
    expect(seriesCadenceLabel("MONTHLY", on(1, 28), clamped)).toBe(
      "Every month on the 31st",
    );
    // On the 15th, with the head alone moved to the 16th.
    const moved = [on(0, 16), on(1, 15), on(2, 15)];
    expect(seriesCadenceLabel("MONTHLY", on(0, 16), moved)).toBe(
      "Every month on the 15th",
    );
    // Without the series, the meeting's own day.
    expect(seriesCadenceLabel("MONTHLY", on(0, 9))).toBe(
      "Every month on the 9th",
    );
  });

  it("reads a rule outside the catalog in sentence case", () => {
    expect(seriesCadenceLabel("DAILY", sunday)).toBe("Daily");
    expect(ruleTokenLabel("TWICE_WEEKLY")).toBe("Twice weekly");
    expect(ruleTokenLabel(null)).toBeNull();
  });

  it("says nothing for a missing rule or an unreadable start", () => {
    expect(seriesCadenceLabel(null, sunday)).toBeNull();
    expect(seriesCadenceLabel("", sunday)).toBeNull();
    expect(seriesCadenceLabel("WEEKLY", "nope")).toBeNull();
  });
});
