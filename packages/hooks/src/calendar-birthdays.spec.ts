import { describe, expect, it } from "vitest";
import {
  calendarBirthdayLabel,
  selectCalendarBirthdays,
} from "./calendar-birthdays";
import {
  ALL_CALENDAR_LAYERS,
  calendarTasksByDay,
  type CalendarTask,
} from "./calendar-tasks";

const dana = {
  id: "u-dana",
  display_name: "Dana Lowe",
  avatar_url: null,
  birthday_month: 3,
  birthday_day: 4,
};
const leap = {
  id: "u-leap",
  display_name: "Leo Park",
  avatar_url: null,
  birthday_month: 2,
  birthday_day: 29,
};

describe("selectCalendarBirthdays (#4959)", () => {
  it("puts each birthday on its day in every year asked for", () => {
    const items = selectCalendarBirthdays([dana], [2026, 2027]);
    expect(items.map((item) => item.day)).toEqual(["2026-03-04", "2027-03-04"]);
    expect(items[0]).toMatchObject({
      kind: "birthdays",
      title: "Dana Lowe",
      userId: "u-dana",
    });
    expect(new Set(items.map((item) => item.key)).size).toBe(2);
  });

  it("moves a leap-day birthday to 28 February outside leap years", () => {
    const items = selectCalendarBirthdays([leap], [2027, 2028]);
    expect(items.map((item) => item.day)).toEqual(["2027-02-28", "2028-02-29"]);
  });

  it("leaves out a member with no name, and reads nothing from no data", () => {
    expect(
      selectCalendarBirthdays([{ ...dana, display_name: " " }], [2026]),
    ).toEqual([]);
    expect(selectCalendarBirthdays(undefined, [2026])).toEqual([]);
  });

  it("says whose birthday it is", () => {
    const [item] = selectCalendarBirthdays([dana], [2026]);
    expect(calendarBirthdayLabel(item!)).toBe("Dana Lowe's birthday");
  });
});

describe("calendarTasksByDay with birthdays (#4959)", () => {
  const task: CalendarTask = {
    kind: "mine",
    key: "task:1",
    taskId: "1",
    title: "Dues form",
    day: "2026-03-04",
    state: "overdue",
    label: "Overdue",
    createdBy: null,
  };
  const birthdays = selectCalendarBirthdays([dana], [2026]);

  it("lists a day's birthdays before its tasks", () => {
    const byDay = calendarTasksByDay([task, ...birthdays], ALL_CALENDAR_LAYERS);
    expect(byDay.get("2026-03-04")?.map((item) => item.kind)).toEqual([
      "birthdays",
      "mine",
    ]);
  });

  it("hides birthdays when their toggle is off", () => {
    const byDay = calendarTasksByDay(
      [task, ...birthdays],
      new Set(["events", "mine", "assigned"] as const),
    );
    expect(byDay.get("2026-03-04")?.map((item) => item.kind)).toEqual(["mine"]);
  });
});
