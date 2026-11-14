"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { components } from "@repo/api-sdk";
import { birthdayDateInYear } from "@repo/validation";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";

/**
 * Birthdays on the Events calendar (#4959): every birthday a member shares
 * with the chapter, as an all-day item on its day each year, in the same
 * per-day lists as tasks so the month, the compact month, Week and Day's
 * all-day row and the phone all draw it. Like Google Calendar's and
 * Facebook's birthdays, it reads apart from an event (a cake, no fill) and has
 * its own toggle, "Birthdays", beside Events and the task kinds.
 *
 * Fed by `GET /v1/members/birthdays`, which lists only birthdays their
 * members chose to share, month and day only: a member who keeps theirs to
 * themselves never reaches a client, and no year is ever sent.
 */

export type MemberBirthday = components["schemas"]["MemberBirthdayDto"];

export interface CalendarBirthday {
  kind: "birthdays";
  /** Unique across the calendar: the member and the year. */
  key: string;
  /** The member's name, as the item's title. */
  title: string;
  userId: string;
  /** The day it falls on, `YYYY-MM-DD`, the key the calendar files events by. */
  day: string;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * Each birthday on its day in each of `years`. A 29 February birthday falls
 * on 28 February outside leap years (`birthdayDateInYear`). A member with no
 * name is left out rather than drawn as an empty item.
 */
export function selectCalendarBirthdays(
  birthdays: readonly MemberBirthday[] | undefined,
  years: readonly number[],
): CalendarBirthday[] {
  if (!birthdays?.length) return [];
  const items: CalendarBirthday[] = [];
  for (const birthday of birthdays) {
    const title = birthday.display_name.trim();
    if (!title) continue;
    for (const year of years) {
      const { month, day } = birthdayDateInYear(
        birthday.birthday_month,
        birthday.birthday_day,
        year,
      );
      items.push({
        kind: "birthdays",
        key: `birthday:${birthday.id}:${year}`,
        title,
        userId: birthday.id,
        day: `${year}-${pad(month)}-${pad(day)}`,
      });
    }
  }
  return items;
}

/** "Dana Lowe's birthday", what a birthday item says on the grid and aloud. */
export function calendarBirthdayLabel(item: CalendarBirthday): string {
  return `${item.title}'s birthday`;
}

/** The chapter's shared birthdays, from `GET /v1/members/birthdays`. */
export function useMemberBirthdays() {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    // Under `["members", …]`, so a profile save (`PROFILE_QUERY_FILTERS`)
    // refreshes it with the directory.
    queryKey: ["members", chapterId, "birthdays"],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/members/birthdays");
      if (error) throw error;
      return data;
    },
    staleTime: 5 * 60_000,
    enabled: !!chapterId,
  });
}

/**
 * The calendar's birthday items for the years around `anchor` (the one before
 * and after too, so a Week or month view that crosses New Year shows both
 * sides).
 */
export function useCalendarBirthdays(anchor: Date): CalendarBirthday[] {
  const query = useMemberBirthdays();
  const year = anchor.getFullYear();
  return useMemo(
    () => selectCalendarBirthdays(query.data, calendarBirthdayYears(year)),
    [query.data, year],
  );
}

/**
 * The years a calendar on `year` draws birthdays for: that one and its
 * neighbours, so a Week or a month grid that crosses New Year shows both
 * sides.
 */
export function calendarBirthdayYears(year: number): number[] {
  return [year - 1, year, year + 1];
}
