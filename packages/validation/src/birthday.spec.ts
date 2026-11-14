import { describe, expect, it } from "vitest";
import {
  birthdayDateInYear,
  daysInBirthdayMonth,
  formatBirthday,
  isValidBirthday,
} from "./birthday";

describe("isValidBirthday", () => {
  it("takes a real month and day, with or without a year", () => {
    expect(isValidBirthday(3, 4)).toBe(true);
    expect(isValidBirthday(12, 31, 2004)).toBe(true);
  });

  it("refuses a day the month doesn't have", () => {
    expect(isValidBirthday(4, 31)).toBe(false);
    expect(isValidBirthday(2, 30)).toBe(false);
    expect(isValidBirthday(13, 1)).toBe(false);
    expect(isValidBirthday(0, 1)).toBe(false);
    expect(isValidBirthday(1, 0)).toBe(false);
    expect(isValidBirthday(1.5, 1)).toBe(false);
  });

  it("takes 29 February without a year, and only in a leap year with one", () => {
    expect(isValidBirthday(2, 29)).toBe(true);
    expect(isValidBirthday(2, 29, 2004)).toBe(true);
    expect(isValidBirthday(2, 29, 2000)).toBe(true);
    expect(isValidBirthday(2, 29, 2003)).toBe(false);
    expect(isValidBirthday(2, 29, 1900)).toBe(false);
  });

  it("refuses a year out of range", () => {
    expect(isValidBirthday(1, 1, 1899)).toBe(false);
    expect(isValidBirthday(1, 1, 2101)).toBe(false);
  });
});

describe("daysInBirthdayMonth", () => {
  it("gives February 29 days without a year", () => {
    expect(daysInBirthdayMonth(2)).toBe(29);
    expect(daysInBirthdayMonth(2, 2005)).toBe(28);
    expect(daysInBirthdayMonth(9)).toBe(30);
    expect(daysInBirthdayMonth(10)).toBe(31);
  });
});

describe("formatBirthday", () => {
  it("names the month and day only", () => {
    expect(formatBirthday(3, 4)).toBe("March 4");
    expect(formatBirthday(13, 4)).toBe("");
  });
});

describe("birthdayDateInYear", () => {
  it("moves a leap-day birthday to 28 February outside leap years", () => {
    expect(birthdayDateInYear(2, 29, 2027)).toEqual({ month: 2, day: 28 });
    expect(birthdayDateInYear(2, 29, 2028)).toEqual({ month: 2, day: 29 });
    expect(birthdayDateInYear(7, 4, 2027)).toEqual({ month: 7, day: 4 });
  });
});
