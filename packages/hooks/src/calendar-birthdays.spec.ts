import { describe, expect, it } from "vitest";
import {
  calendarBirthdayLabel,
  calendarBirthdayYears,
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

  it("covers a week that crosses New Year from either side", () => {
    const jan2 = { ...dana, birthday_month: 1, birthday_day: 2 };
    const dec30 = { ...dana, birthday_month: 12, birthday_day: 30 };
    // A week of 28 Dec 2026 – 3 Jan 2027, anchored in December or January.
    const fromDecember = selectCalendarBirthdays(
      [jan2],
      calendarBirthdayYears(2026),
    ).map((item) => item.day);
    const fromJanuary = selectCalendarBirthdays(
      [dec30],
      calendarBirthdayYears(2027),
    ).map((item) => item.day);
    expect(fromDecember).toContain("2027-01-02");
    expect(fromJanuary).toContain("2026-12-30");
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
