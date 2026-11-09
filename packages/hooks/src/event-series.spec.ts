import { describe, expect, it } from "vitest";
import {
  collapseSeries,
  EVENT_HORIZON_DAYS,
  eventSeriesKey,
  seriesCadenceLabel,
  splitByHorizon,
} from "./event-series";

/** A local wall-clock instant as the API sends it, so the suite holds in any TZ. */
function iso(month: number, day: number, hour = 18): string {
  return new Date(2026, month - 1, day, hour).toISOString();
}

// Monday Nov 9, 2026, 9:00 AM local.
const NOW = new Date(2026, 10, 9, 9);

interface Row {
  id: string;
  name: string;
  start_time: string;
  recurrence_rule: string | null;
  parent_event_id: string | null;
}

/** A weekly "Chapter" series as the API materializes it: head plus children. */
function weeklySeries(headDay: number, count: number): Row[] {
  return Array.from({ length: count }, (_, index) => ({
    id: index === 0 ? "head" : `child-${index}`,
    name: "Chapter",
    start_time: iso(11, headDay + index * 7),
    recurrence_rule: index === 0 ? "WEEKLY" : null,
    parent_event_id: index === 0 ? null : "head",
  }));
}

function oneOff(id: string, month: number, day: number): Row {
  return {
    id,
    name: id,
    start_time: iso(month, day),
    recurrence_rule: null,
    parent_event_id: null,
  };
}

describe("eventSeriesKey", () => {
  it("names a series by its head, from the head or any occurrence", () => {
    const [head, child] = weeklySeries(8, 2);
    expect(eventSeriesKey(head!)).toBe("head");
    expect(eventSeriesKey(child!)).toBe("head");
    expect(eventSeriesKey(oneOff("social", 11, 12))).toBeNull();
  });
});

describe("collapseSeries", () => {
  it("draws a weekly series once, as its next occurrence, with its rule", () => {
    // Head on Sunday Nov 8 (already happened), then every Sunday.
    const rows = [...weeklySeries(8, 13), oneOff("social", 11, 12)];
    const collapsed = collapseSeries(rows, NOW);

    const chapter = collapsed.filter((entry) => entry.event.name === "Chapter");
    // The started head stands alone; the upcoming twelve collapse to one.
    expect(chapter).toHaveLength(2);
    expect(chapter[0]).toMatchObject({ event: { id: "head" }, series: null });
    expect(chapter[0]!.rule).toBe("WEEKLY");
    expect(chapter[1]!.event.id).toBe("child-1");
    expect(chapter[1]!.series).toHaveLength(12);
    expect(chapter[1]!.series![0]!.id).toBe("child-1");
    expect(chapter[1]!.rule).toBe("WEEKLY");

    // Soonest first, the one-off in its place.
    expect(collapsed.map((entry) => entry.event.id)).toEqual([
      "head",
      "social",
      "child-1",
    ]);
  });

  it("leaves one-time events alone and reads no rule for them", () => {
    const collapsed = collapseSeries([oneOff("b", 11, 20), oneOff("a", 11, 10)], NOW);
    expect(collapsed.map((entry) => entry.event.id)).toEqual(["a", "b"]);
    expect(collapsed.every((entry) => entry.series === null && entry.rule === null)).toBe(true);
  });

  it("keeps a series whose head is missing, without a rule", () => {
    const children = weeklySeries(8, 4).slice(1);
    const [entry] = collapseSeries(children, NOW);
    expect(entry!.series).toHaveLength(3);
    expect(entry!.rule).toBeNull();
  });

  it("puts an unreadable start last rather than throwing", () => {
    const broken = { ...oneOff("broken", 11, 10), start_time: "nope" };
    const collapsed = collapseSeries([broken, oneOff("ok", 11, 11)], NOW);
    expect(collapsed.map((entry) => entry.event.id)).toEqual(["ok", "broken"]);
  });
});

describe("splitByHorizon", () => {
  it("holds today through the 14th day after it, and leaves the rest for Later", () => {
    expect(EVENT_HORIZON_DAYS).toBe(14);
    const entries = [
      { event: oneOff("today", 11, 9) },
      { event: oneOff("day-14", 11, 23) },
      { event: oneOff("day-15", 11, 24) },
      { event: { ...oneOff("broken", 11, 10), start_time: "" } },
    ];
    const { soon, later } = splitByHorizon(entries, NOW);
    expect(soon.map((entry) => entry.event.id)).toEqual(["today", "day-14"]);
    expect(later.map((entry) => entry.event.id)).toEqual(["day-15", "broken"]);
  });

  it("counts a meeting still running from last night as soon", () => {
    const { soon } = splitByHorizon([{ event: oneOff("late", 11, 8) }], NOW);
    expect(soon).toHaveLength(1);
  });
});

describe("seriesCadenceLabel", () => {
  // Sunday Nov 15, 2026.
  const sunday = iso(11, 15);

  it("says the weekday for a weekly or every-other-week series", () => {
    expect(seriesCadenceLabel("WEEKLY", sunday)).toBe("Every Sunday");
    expect(seriesCadenceLabel("BIWEEKLY", sunday)).toBe("Every other Sunday");
  });

  it("says the day of the month for a monthly series", () => {
    expect(seriesCadenceLabel("MONTHLY", sunday)).toBe("Every month on the 15th");
    expect(seriesCadenceLabel("MONTHLY", iso(11, 1))).toBe("Every month on the 1st");
    expect(seriesCadenceLabel("MONTHLY", iso(11, 2))).toBe("Every month on the 2nd");
    expect(seriesCadenceLabel("MONTHLY", iso(11, 3))).toBe("Every month on the 3rd");
    expect(seriesCadenceLabel("MONTHLY", iso(11, 11))).toBe("Every month on the 11th");
    expect(seriesCadenceLabel("MONTHLY", iso(11, 22))).toBe("Every month on the 22nd");
  });

  it("says nothing for a one-time event or an unreadable start", () => {
    expect(seriesCadenceLabel(null, sunday)).toBeNull();
    expect(seriesCadenceLabel("DAILY", sunday)).toBeNull();
    expect(seriesCadenceLabel("WEEKLY", "nope")).toBeNull();
  });
});
