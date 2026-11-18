import { describe, expect, it } from "vitest";
import {
  MINUTES_MANY,
  matchesQuery,
  minutesListView,
  minutesRowTime,
  minutesSeries,
  type MinutesListRow,
} from "./minutes-list";

/**
 * The Minutes list's grouping (#5290): a few minutes read as drafts and day
 * groups; a long list gains type counts, a Series section and month groups,
 * and narrows by type and by what is typed.
 */
// A Wednesday at noon, on this machine's clock: the week began Sunday.
const NOW = new Date(2026, 10, 18, 12).getTime();
const daysAgo = (days: number) =>
  new Date(NOW - days * 86_400_000).toISOString();

let next = 0;
function row(over: Partial<MinutesListRow> = {}): MinutesListRow {
  next += 1;
  return {
    id: `m${next}`,
    event_id: `e${next}`,
    event_name: "Chapter Meeting",
    event_start_time: daysAgo(1),
    meeting_type: "chapter",
    other_label: null,
    status: "posted",
    created_by: null,
    posted_at: null,
    updated_at: daysAgo(1),
    series_key: null,
    series_rule: null,
    decision_count: 0,
    action_item_count: 0,
    recorded: false,
    ...over,
  };
}

describe("minutesListView", () => {
  it("shows a few minutes as drafts, then this calendar week, last week and months, with no filters", () => {
    const rows = [
      row({ id: "draft", status: "draft", event_start_time: daysAgo(0) }),
      row({ id: "sun", event_start_time: daysAgo(2) }),
      row({ id: "prev", event_start_time: daysAgo(9) }),
      row({ id: "old", event_start_time: daysAgo(40) }),
    ];
    const view = minutesListView(rows, { now: NOW, type: "exec", query: "x" });
    expect(view.many).toBe(false);
    // A short list doesn't narrow, whatever is asked.
    expect(view.narrowed).toBe(false);
    expect(view.drafts.map((r) => r.id)).toEqual(["draft"]);
    expect(view.series).toEqual([]);
    expect(view.groups.map((g) => [g.label, g.rows.map((r) => r.id)])).toEqual([
      ["This week", ["sun"]],
      ["Last week", ["prev"]],
      ["October", ["old"]],
    ]);
  });

  it("past eight, counts the types, folds a repeating event into a series, and groups by month", () => {
    const sundays = Array.from({ length: 6 }, (_, i) =>
      row({
        id: `sun${i}`,
        event_start_time: daysAgo(i * 7 + 1),
        series_key: "head",
        series_rule: "WEEKLY",
      }),
    );
    const rows = [
      ...sundays,
      row({ id: "exec1", meeting_type: "exec", event_name: "Exec Meeting" }),
      row({ id: "exec2", meeting_type: "exec", event_name: "Exec Meeting" }),
      // One meeting of a series isn't a series yet.
      row({ id: "lone", series_key: "solo", meeting_type: "committee" }),
    ];
    expect(rows.length).toBeGreaterThan(MINUTES_MANY);
    const view = minutesListView(rows, { now: NOW });
    expect(view.many).toBe(true);
    expect(view.types).toEqual([
      { type: "chapter", count: 6 },
      { type: "exec", count: 2 },
      { type: "committee", count: 1 },
    ]);
    expect(view.series).toHaveLength(1);
    expect(view.series[0]).toMatchObject({
      key: "head",
      count: 6,
      rule: "WEEKLY",
      last: daysAgo(1),
    });
    // Every minute stays in its month too; the series is a way to browse.
    expect(view.groups.flatMap((g) => g.rows)).toHaveLength(rows.length);
    expect(view.groups[0].label).toBe("November");
  });

  it("narrows by type and by what is typed, and drops the series while it does", () => {
    const rows = [
      ...Array.from({ length: 7 }, () => row({ series_key: "head" })),
      row({ id: "exec", meeting_type: "exec", event_name: "Exec Meeting" }),
      row({
        id: "formal",
        meeting_type: "committee",
        event_name: "Formal Planning",
      }),
    ];
    const byType = minutesListView(rows, { now: NOW, type: "exec" });
    expect(byType.narrowed).toBe(true);
    expect(byType.series).toEqual([]);
    expect(byType.groups.flatMap((g) => g.rows).map((r) => r.id)).toEqual([
      "exec",
    ]);
    const byQuery = minutesListView(rows, { now: NOW, query: "formal" });
    expect(byQuery.groups.flatMap((g) => g.rows).map((r) => r.id)).toEqual([
      "formal",
    ]);
  });

  it("names a month of another year with its year", () => {
    const rows = Array.from({ length: 9 }, () =>
      row({ event_start_time: "2025-03-10T23:00:00Z" }),
    );
    expect(minutesListView(rows, { now: NOW }).groups[0].label).toBe(
      "March 2025",
    );
  });
});

describe("minutesSeries", () => {
  it("names a series by its newest meeting and keeps every start for the cadence", () => {
    const [series] = minutesSeries([
      row({
        series_key: "s",
        event_name: "Old name",
        event_start_time: daysAgo(8),
      }),
      row({
        series_key: "s",
        event_name: "Chapter",
        event_start_time: daysAgo(1),
      }),
    ]);
    expect(series.name).toBe("Chapter");
    expect(series.starts).toEqual([daysAgo(1), daysAgo(8)]);
  });
});

describe("matchesQuery", () => {
  it("matches the name or the type, every word, in any case", () => {
    const exec = row({ meeting_type: "exec", event_name: "Monday sync" });
    expect(matchesQuery(exec, "EXEC monday")).toBe(true);
    expect(matchesQuery(exec, "exec budget")).toBe(false);
    expect(matchesQuery(exec, "  ")).toBe(true);
  });
});

describe("minutesRowTime", () => {
  it("says the weekday and time this calendar week, the date before, and the year only when it differs", () => {
    // Last Wednesday is six days back but not this week: a date, never "Wed".
    expect(minutesRowTime(daysAgo(6.9), NOW)).toMatch(/^Nov \d{1,2}$/);
    expect(minutesRowTime(daysAgo(2), NOW)).toMatch(
      /^[A-Z][a-z]{2} \d{1,2}:\d{2} [AP]M$/,
    );
    expect(minutesRowTime("2026-10-02T23:00:00Z", NOW)).toMatch(
      /^Oct \d{1,2}$/,
    );
    expect(minutesRowTime("2025-10-02T23:00:00Z", NOW)).toMatch(/, 2025$/);
  });
});
