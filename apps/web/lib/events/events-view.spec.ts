import { afterEach, describe, expect, it } from "vitest";
import {
  calendarCreateStart,
  readCalendarView,
  writeCalendarView,
} from "./events-view";

describe("calendar view memory (#4818)", () => {
  afterEach(() => window.localStorage.clear());

  it("reads back the Month / Week / Day choice for that user", () => {
    writeCalendarView("user-1", "week");
    expect(readCalendarView("user-1")).toBe("week");
    expect(readCalendarView("user-2")).toBeNull();
  });

  it("ignores anything stored that isn't a view", () => {
    window.localStorage.setItem("frapp.events.calendar-view.user-1", "year");
    expect(readCalendarView("user-1")).toBeNull();
  });

  it("has nothing to read before the viewer is known", () => {
    expect(readCalendarView(null)).toBeNull();
  });
});

describe("calendarCreateStart", () => {
  const day = new Date(2026, 10, 13, 9, 41);

  it("starts a day-number event at 6 PM", () => {
    expect(calendarCreateStart(day)).toEqual(new Date(2026, 10, 13, 18));
  });

  it("starts an hour's event at that hour", () => {
    expect(calendarCreateStart(day, 15)).toEqual(new Date(2026, 10, 13, 15));
  });
});
