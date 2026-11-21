import { describe, expect, it } from "vitest";
import { minutesTimeline } from "./minutes-timeline";

// A Friday afternoon, local time.
const NOW = new Date(2026, 10, 20, 15, 0).getTime();
const daysAgo = (days: number) =>
  new Date(NOW - days * 86_400_000).toISOString();

describe("minutesTimeline", () => {
  it("puts every past meeting at its date, newest first, in week groups", () => {
    const groups = minutesTimeline(
      [
        { id: "m1", event_start_time: daysAgo(1) },
        { id: "m2", event_start_time: daysAgo(10) },
      ],
      {
        write: [{ id: "e1", name: "Committee", start_time: daysAgo(0.5) }],
        skipped: [{ id: "e2", name: "Exec", start_time: daysAgo(3) }],
        now: NOW,
      },
    );
    expect(
      groups.map((group) => [group.label, group.items.map((item) => item.key)]),
    ).toEqual([
      ["This week", ["event:e1", "minutes:m1", "event:e2"]],
      ["Last week", ["minutes:m2"]],
    ]);
  });

  it("files minutes started ahead for a later week under their month", () => {
    const groups = minutesTimeline(
      [
        { id: "ahead", event_start_time: new Date(2026, 11, 10).toISOString() },
        { id: "m1", event_start_time: daysAgo(1) },
      ],
      { now: NOW },
    );
    expect(groups.map((group) => group.label)).toEqual([
      "December",
      "This week",
    ]);
  });

  it("starts Last week at last Sunday's midnight across a clock change", () => {
    // Sunday Nov 1 2026 is when US daylight time ends; a week later, a
    // meeting just after that midnight is still last week.
    const now = new Date(2026, 10, 9, 12).getTime();
    const groups = minutesTimeline(
      [
        {
          id: "m",
          event_start_time: new Date(2026, 10, 1, 0, 30).toISOString(),
        },
      ],
      { now },
    );
    expect(groups.map((group) => group.label)).toEqual(["Last week"]);
  });

  it("groups a long list by month alone", () => {
    const rows = Array.from({ length: 9 }, (_, i) => ({
      id: `m${i}`,
      event_start_time: daysAgo(i),
    }));
    const groups = minutesTimeline(rows, { now: NOW });
    expect(groups.map((group) => group.label)).toEqual(["November"]);
  });
});
