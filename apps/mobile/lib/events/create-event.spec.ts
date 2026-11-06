import { describe, expect, it } from "vitest";
import {
  defaultEventDate,
  emptyEventDraft,
  endsNextDay,
  joinClock,
  monthGrid,
  resolveEventDate,
  shiftEnd,
  splitClock,
  validateNewEvent,
  type NewEventDraft,
} from "./create-event";

/** Local wall-clock times, so the spec reads the same in any time zone. */
const AFTERNOON = new Date(2026, 10, 6, 14, 20);
const EVENING = new Date(2026, 10, 6, 19, 30);

function draft(patch: Partial<NewEventDraft> = {}): NewEventDraft {
  return { ...emptyEventDraft(AFTERNOON), name: "Chapter meeting", ...patch };
}

describe("a new event draft", () => {
  it("starts today at 7 to 8 PM, 10 points, not mandatory", () => {
    expect(emptyEventDraft(AFTERNOON)).toEqual({
      name: "",
      date: "2026-11-06",
      start: 19 * 60,
      end: 20 * 60,
      location: "",
      pointsInput: "10",
      isMandatory: false,
    });
  });

  it("starts tomorrow once 7 PM has passed", () => {
    expect(defaultEventDate(EVENING)).toBe("2026-11-07");
  });

  it("falls back to the default day when a kept day has passed", () => {
    expect(resolveEventDate("2026-11-05", AFTERNOON)).toBe("2026-11-06");
    expect(resolveEventDate("2026-11-20", AFTERNOON)).toBe("2026-11-20");
  });
});

describe("validateNewEvent", () => {
  it("builds the request from local wall-clock times", () => {
    const result = validateNewEvent(
      draft({
        location: "  Great Hall ",
        pointsInput: "25",
        isMandatory: true,
      }),
    );
    expect(result).toEqual({
      ok: true,
      body: {
        name: "Chapter meeting",
        start_time: new Date(2026, 10, 6, 19, 0).toISOString(),
        end_time: new Date(2026, 10, 6, 20, 0).toISOString(),
        location: "Great Hall",
        point_value: 25,
        is_mandatory: true,
      },
    });
  });

  it("reads an end before the start as the next morning", () => {
    const result = validateNewEvent(draft({ start: 21 * 60, end: 60 }));
    expect(result.ok && result.body.end_time).toBe(
      new Date(2026, 10, 7, 1, 0).toISOString(),
    );
  });

  it("omits a blank location and sends a blank points field as 0", () => {
    const result = validateNewEvent(draft({ pointsInput: " " }));
    expect(result.ok && result.body).not.toHaveProperty("location");
    expect(result.ok && result.body.point_value).toBe(0);
  });

  it("names every problem at once", () => {
    expect(
      validateNewEvent(
        draft({ name: "  ", start: 600, end: 600, pointsInput: "1.5" }),
      ),
    ).toEqual({
      ok: false,
      errors: {
        name: "Give the event a name.",
        time: "The event has to end after it starts.",
        points: "Points must be a whole number, up to 100,000.",
      },
    });
  });
});

describe("times", () => {
  it("moves the end with the start, keeping the length", () => {
    expect(shiftEnd(19 * 60, 20 * 60, 21 * 60)).toBe(22 * 60);
    // Across midnight.
    expect(shiftEnd(19 * 60, 21 * 60, 23 * 60)).toBe(60);
  });

  it("knows an earlier end means the next day", () => {
    expect(endsNextDay(21 * 60, 60)).toBe(true);
    expect(endsNextDay(19 * 60, 20 * 60)).toBe(false);
  });

  it("splits and joins a 12-hour clock", () => {
    expect(splitClock(0)).toEqual({ hour12: 12, minute: 0, pm: false });
    expect(splitClock(12 * 60 + 15)).toEqual({
      hour12: 12,
      minute: 15,
      pm: true,
    });
    expect(splitClock(19 * 60 + 45)).toEqual({
      hour12: 7,
      minute: 45,
      pm: true,
    });
    expect(joinClock(12, 0, false)).toBe(0);
    expect(joinClock(12, 30, true)).toBe(12 * 60 + 30);
    expect(joinClock(7, 45, true)).toBe(19 * 60 + 45);
  });
});

describe("monthGrid", () => {
  it("lays November 2026 out Sunday first", () => {
    const weeks = monthGrid(2026, 10);
    // November 1, 2026 is a Sunday.
    expect(weeks[0]![0]).toBe("2026-11-01");
    expect(weeks.at(-1)).toEqual([
      "2026-11-29",
      "2026-11-30",
      null,
      null,
      null,
      null,
      null,
    ]);
    expect(weeks.every((week) => week.length === 7)).toBe(true);
  });

  it("pads the days before the 1st", () => {
    // October 1, 2026 is a Thursday.
    expect(monthGrid(2026, 9)[0]).toEqual([
      null,
      null,
      null,
      null,
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
    ]);
  });
});
