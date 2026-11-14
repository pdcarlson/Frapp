/**
 * A member's birthday (#4959): month and day, an optional year that is never
 * shown to anyone else, and who may see it. The API enforces these rules
 * (`UpdateUserDto`, the `users_birthday_valid` check); the profile forms on
 * web and the phone read them so a refusal comes before the round trip.
 *
 * Modelled on how people already meet birthdays: Facebook asks for month and
 * day with the year optional and lets the member pick who sees it; Discord
 * birthday bots post on the day in a channel a server admin picks.
 */

/** Who may see a member's birthday. `nobody` is the default. */
export const BIRTHDAY_VISIBILITIES = ["chapter", "nobody"] as const;
export type BirthdayVisibility = (typeof BIRTHDAY_VISIBILITIES)[number];
export const BIRTHDAY_VISIBILITY_DEFAULT: BirthdayVisibility = "nobody";

/** A stored or typed visibility, or the default for anything unknown. */
export function parseBirthdayVisibility(value: unknown): BirthdayVisibility {
  return (BIRTHDAY_VISIBILITIES as readonly unknown[]).includes(value)
    ? (value as BirthdayVisibility)
    : BIRTHDAY_VISIBILITY_DEFAULT;
}

/** The bounds the API and the database check take a birth year in. */
export const BIRTH_YEAR_MIN = 1900;
export const BIRTH_YEAR_MAX = 2100;

export const BIRTHDAY_MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * The last day of `month` (1-12). Without a year, February has 29 days, since
 * a member may leave the year off a leap-day birthday.
 */
export function daysInBirthdayMonth(
  month: number,
  year?: number | null,
): number {
  if (month === 2) return year == null || isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/**
 * Whether month, day and an optional year make a birthday the API takes:
 * whole numbers, a real day in that month, a year in range, and 29 February
 * only in a leap year when a year is given.
 */
export function isValidBirthday(
  month: number,
  day: number,
  year?: number | null,
): boolean {
  if (!Number.isInteger(month) || month < 1 || month > 12) return false;
  if (year != null) {
    if (
      !Number.isInteger(year) ||
      year < BIRTH_YEAR_MIN ||
      year > BIRTH_YEAR_MAX
    ) {
      return false;
    }
  }
  if (!Number.isInteger(day) || day < 1) return false;
  return day <= daysInBirthdayMonth(month, year);
}

/** Which part of a birthday being typed is wrong, and what to tell the member. */
export interface BirthdayDraftProblem {
  field: "month" | "day" | "year";
  message: string;
}

/**
 * Why a birthday a member typed can't be saved, naming the part to fix, or
 * null when it can (all three empty clears it). The profile forms on web and
 * the phone both read it, so the refusal sits on the field that is wrong.
 * The API's own check is {@link isValidBirthday}; this agrees with it.
 */
export function birthdayDraftProblem(
  month: number | null,
  day: number | null,
  year: number | null,
): BirthdayDraftProblem | null {
  if (month === null && day === null && year === null) return null;
  if (
    year !== null &&
    (!Number.isInteger(year) || year < BIRTH_YEAR_MIN || year > BIRTH_YEAR_MAX)
  ) {
    return { field: "year", message: BIRTHDAY_COPY.yearInvalid };
  }
  if (month === null || !Number.isInteger(month) || month < 1 || month > 12) {
    return { field: "month", message: BIRTHDAY_COPY.invalid };
  }
  if (day === null || !Number.isInteger(day) || day < 1) {
    return { field: "day", message: BIRTHDAY_COPY.invalid };
  }
  if (day > daysInBirthdayMonth(month, year)) {
    // A real day for the month but not the year: 29 February.
    return day <= daysInBirthdayMonth(month)
      ? { field: "year", message: BIRTHDAY_COPY.notLeapYear }
      : { field: "day", message: BIRTHDAY_COPY.invalid };
  }
  return null;
}

/** "March 4". The year is never part of it: no surface shows it. */
export function formatBirthday(month: number, day: number): string {
  const name = BIRTHDAY_MONTH_NAMES[month - 1];
  return name ? `${name} ${day}` : "";
}

/**
 * The day a birthday falls on in `year`, as `{ month, day }`. A 29 February
 * birthday falls on 28 February outside leap years, the day Facebook and most
 * birthday bots use.
 */
export function birthdayDateInYear(
  month: number,
  day: number,
  year: number,
): { month: number; day: number } {
  if (month === 2 && day === 29 && !isLeapYear(year))
    return { month: 2, day: 28 };
  return { month, day };
}

/** The profile form's words for the birthday, on web and the phone. */
export const BIRTHDAY_COPY = {
  label: "Birthday",
  monthLabel: "Month",
  dayLabel: "Day",
  yearLabel: "Year (optional)",
  yearHint: "The year is optional, and nobody else ever sees it.",
  visibilityLabel: "Who can see it",
  visibility: {
    chapter: "Your chapter",
    nobody: "Only you",
  } satisfies Record<BirthdayVisibility, string>,
  visibilityHint: {
    chapter: "Members of your chapter see the day on your profile.",
    nobody: "Nobody else sees it.",
  } satisfies Record<BirthdayVisibility, string>,
  invalid: "Pick a month and a day that exists in it.",
  yearInvalid: `Enter a year from ${BIRTH_YEAR_MIN} to ${BIRTH_YEAR_MAX}, or leave it empty.`,
  notLeapYear: "That year has no February 29.",
  clear: "Remove birthday",
} as const;
