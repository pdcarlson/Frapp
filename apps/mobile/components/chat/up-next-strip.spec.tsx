/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import {
  formatDueDate,
  formatEventTime,
  isDueUrgent,
  selectNextEvent,
  selectNextTask,
} from "./up-next-strip";

/**
 * The strip's whole job is picking the *one* right event and the *one* right
 * task out of two unfiltered lists, so the selectors carry all of the risk.
 *
 * Times are built from explicit local-time constructor args rather than ISO
 * strings, because the relative labels are calendar-day comparisons and an ISO
 * string with a `Z` would shift across the day boundary depending on the host's
 * zone.
 */

const NOW = new Date(2026, 7, 16, 12, 0, 0); // 2026-08-16, midday, local

function at(year: number, month: number, day: number, hour = 12, minute = 0) {
  return new Date(year, month, day, hour, minute).toISOString();
}

describe("selectNextEvent", () => {
  it("returns the soonest event still ahead of now", () => {
    const event = selectNextEvent(
      [
        { id: "c", name: "Later", start_time: at(2026, 7, 20), location: null },
        {
          id: "a",
          name: "Soonest",
          start_time: at(2026, 7, 16, 18),
          location: "Great Hall",
        },
        {
          id: "b",
          name: "Middle",
          start_time: at(2026, 7, 18),
          location: null,
        },
      ],
      NOW,
    );

    expect(event?.name).toBe("Soonest");
    expect(event?.location).toBe("Great Hall");
  });

  it("ignores events that have already started", () => {
    const event = selectNextEvent(
      [
        {
          id: "past",
          name: "This morning",
          start_time: at(2026, 7, 16, 8),
          location: null,
        },
        {
          id: "next",
          name: "Tonight",
          start_time: at(2026, 7, 16, 18),
          location: null,
        },
      ],
      NOW,
    );

    expect(event?.name).toBe("Tonight");
  });

  it("returns null when everything is in the past", () => {
    expect(
      selectNextEvent(
        [{ id: "a", name: "Old", start_time: at(2026, 6, 1), location: null }],
        NOW,
      ),
    ).toBeNull();
  });

  it("survives a non-array, a null, and rows missing required fields", () => {
    // `GET /v1/events` infers as `never` in the SDK, so this is fed whatever the
    // runtime actually returns — the selector must not throw on any of it.
    expect(selectNextEvent(undefined, NOW)).toBeNull();
    expect(selectNextEvent(null, NOW)).toBeNull();
    expect(selectNextEvent("not a list", NOW)).toBeNull();
    expect(selectNextEvent([null, 42, { id: "a" }], NOW)).toBeNull();
    expect(
      selectNextEvent(
        [{ id: "a", name: "No date", start_time: "banana" }],
        NOW,
      ),
    ).toBeNull();
  });
});

describe("selectNextTask", () => {
  it("returns the nearest due task", () => {
    const task = selectNextTask([
      { id: "b", title: "Later", due_date: at(2026, 7, 25), status: "TODO" },
      { id: "a", title: "Sooner", due_date: at(2026, 7, 17), status: "TODO" },
    ]);

    expect(task?.title).toBe("Sooner");
  });

  it("excludes completed tasks", () => {
    const task = selectNextTask([
      {
        id: "done",
        title: "Done",
        due_date: at(2026, 7, 16),
        status: "COMPLETED",
      },
      { id: "open", title: "Open", due_date: at(2026, 7, 20), status: "TODO" },
    ]);

    expect(task?.title).toBe("Open");
  });

  it("keeps overdue tasks — they are the most urgent thing the strip can say", () => {
    const task = selectNextTask([
      {
        id: "late",
        title: "Overdue",
        due_date: at(2026, 6, 1),
        status: "OVERDUE",
      },
      { id: "soon", title: "Soon", due_date: at(2026, 7, 17), status: "TODO" },
    ]);

    expect(task?.title).toBe("Overdue");
  });

  it("survives malformed input", () => {
    expect(selectNextTask(undefined)).toBeNull();
    expect(selectNextTask([{ id: "a", title: "No due date" }])).toBeNull();
  });
});

describe("formatEventTime", () => {
  // These assert which *branch* was taken, never the exact clock rendering.
  // `toLocaleTimeString` is locale-dependent — the same instant is "6:00 PM"
  // under en-US and "18:00" under en-GB or de-DE — so pinning the digits would
  // make the suite fail on a runner whose locale changed, for no real defect.
  // The minutes are the one stable part across both 12h and 24h forms.
  it("shows a clock time for today", () => {
    const label = formatEventTime(at(2026, 7, 16, 18, 0), NOW);

    expect(label).toMatch(/:00/);
    expect(label).not.toMatch(/tmrw/);
  });

  it("labels tomorrow and keeps the clock time", () => {
    const label = formatEventTime(at(2026, 7, 17, 18, 0), NOW);

    expect(label).toMatch(/^tmrw /);
    expect(label).toMatch(/:00/);
  });

  it("uses a weekday inside the week and drops the clock beyond it", () => {
    expect(formatEventTime(at(2026, 7, 19, 18, 0), NOW)).not.toMatch(/tmrw/);
    // Past a week the label is a bare date, so it carries no time separator.
    expect(formatEventTime(at(2026, 8, 30, 18, 0), NOW)).not.toMatch(/:/);
  });

  it("returns an empty string rather than 'Invalid Date'", () => {
    expect(formatEventTime("banana", NOW)).toBe("");
  });
});

describe("formatDueDate", () => {
  it("names the near states explicitly", () => {
    expect(formatDueDate(at(2026, 6, 1), NOW)).toBe("overdue");
    expect(formatDueDate(at(2026, 7, 16, 23), NOW)).toBe("due today");
    expect(formatDueDate(at(2026, 7, 17, 9), NOW)).toBe("due tmrw");
  });

  it("compares calendar days, not elapsed hours", () => {
    // Due at 09:00 tomorrow is 21 hours away — under one 24h period, but a
    // different day, and "due today" would be wrong.
    expect(formatDueDate(at(2026, 7, 17, 9), NOW)).toBe("due tmrw");
  });

  it("returns an empty string on an unparseable date", () => {
    expect(formatDueDate("", NOW)).toBe("");
  });
});

describe("isDueUrgent", () => {
  it("is true for overdue, today, and tomorrow", () => {
    expect(isDueUrgent(at(2026, 6, 1), NOW)).toBe(true);
    expect(isDueUrgent(at(2026, 7, 16, 23), NOW)).toBe(true);
    expect(isDueUrgent(at(2026, 7, 17, 1), NOW)).toBe(true);
  });

  it("is false further out", () => {
    expect(isDueUrgent(at(2026, 7, 18), NOW)).toBe(false);
  });

  it("is false on an unparseable date rather than defaulting to alarm", () => {
    expect(isDueUrgent("banana", NOW)).toBe(false);
  });
});
