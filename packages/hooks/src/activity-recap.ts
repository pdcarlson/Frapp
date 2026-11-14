"use client";

import { useQuery } from "@tanstack/react-query";
import type { components } from "@repo/api-sdk";
import { formatMinutesRounded, formatWeekSpan } from "@repo/formatting";
import { localWeekStart } from "./activity-standing";
import { createChapterQueryKeys } from "./chapter-query-keys";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";

export type ActivityRecap = components["schemas"]["ActivityRecapDto"];
export type ActivityRecapPart = ActivityRecap["unavailable"][number];

/** Chapter-scoped keys; the read is `activityRecapKeys.chapter(chapterId)`. */
export const activityRecapKeys = createChapterQueryKeys("activity-recap");

/**
 * How many days of the week the recap shows for: Sunday, Monday and Tuesday.
 * A digest of last week read on a Friday is news about a fortnight ago.
 */
export const RECAP_SHOWN_DAYS = 3;

/** Whether `now` is early enough in the member's week to show last week's recap. */
export function recapInSeason(now: Date = new Date()): boolean {
  return now.getDay() < RECAP_SHOWN_DAYS;
}

/**
 * The member's last finished week (`GET /v1/activity/recap`,
 * `spec/behavior/activity.md` § Recap), for the card under the week card on Activity
 * in the first days of the next one. Read only then: the rest of the week
 * the card isn't drawn (`activityRecapCard` checks the day as it draws) and
 * the read isn't made.
 *
 * A finished week changes only when something is backdated (an officer
 * approving last week's hours, a late point award), so it is read once per
 * visit to the page and kept for five minutes.
 */
export function useActivityRecap(options: { enabled?: boolean } = {}) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  const week = recapWeek();
  return useQuery({
    // By week, so a recap kept from one week is never drawn for the next.
    queryKey: [...activityRecapKeys.chapter(chapterId!), week.week_start],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/activity/recap", {
        params: { query: week },
      });
      if (error) throw error;
      return data;
    },
    staleTime: 5 * 60 * 1000,
    enabled: !!chapterId && recapInSeason() && (options.enabled ?? true),
  });
}

/**
 * The recap's week by this device's clock: where this week began, and where
 * last week began and on which day. Last Sunday is counted on the calendar,
 * not as seven days back, so a week that crosses a clock change starts at
 * its own midnight, and the day is this device's, which the server can't
 * work out east of UTC+12.
 */
export function recapWeek(now: Date = new Date()): {
  week_start: string;
  last_week_start: string;
  first_day: string;
} {
  const end = localWeekStart(now);
  const start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 7);
  const pad = (value: number) => String(value).padStart(2, "0");
  return {
    week_start: end.toISOString(),
    last_week_start: start.toISOString(),
    first_day: `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`,
  };
}

/** One figure on the recap card: "3" and "events". */
export interface RecapFigure {
  id: ActivityRecapPart;
  figure: string;
  label: string;
  /** For a screen reader: the figure in a few words. */
  spokenLabel: string;
}

/** The recap's card, or `null` when there is nothing to recap. */
export interface RecapCard {
  /** The week it sums up, as the card's subtitle: "Nov 8 – Nov 14". */
  range: string;
  figures: RecapFigure[];
  /**
   * What a dismissal is remembered by: the end of the week it sums up, so
   * dismissing this week's recap leaves next week's to show. A client keys
   * it by chapter too (`recapDismissalKey`).
   */
  dismissKey: string;
}

const plural = (count: number, one: string, many: string) =>
  count === 1 ? one : many;

/**
 * The recap as the card draws it. A part the chapter has off, that couldn't
 * be read, or that is zero is left out: the card is a digest of what the
 * member did, and a row of zeros or "couldn't load" says nothing worth the
 * space at the top of the page. With nothing left, there is no card.
 */
export function activityRecapCard(
  recap: ActivityRecap,
  now: Date = new Date(),
): RecapCard | null {
  // A recap still in the cache after Tuesday is not drawn: the query stops
  // reading then, but keeps what it read.
  if (!recapInSeason(now)) return null;
  const figures: RecapFigure[] = [];
  const {
    events_attended,
    tasks_done,
    points,
    service_minutes,
    study_minutes,
  } = recap;
  if (events_attended) {
    const label = plural(events_attended, "event", "events");
    figures.push({
      id: "events",
      figure: String(events_attended),
      label,
      spokenLabel: `${events_attended} ${label} attended`,
    });
  }
  if (tasks_done) {
    const label = plural(tasks_done, "task done", "tasks done");
    figures.push({
      id: "tasks",
      figure: String(tasks_done),
      label,
      spokenLabel: `${tasks_done} ${label}`,
    });
  }
  if (points) {
    const label = plural(Math.abs(points), "point", "points");
    figures.push({
      id: "points",
      figure: points > 0 ? `+${points}` : String(points),
      label,
      spokenLabel:
        points > 0 ? `${points} ${label} earned` : `${-points} ${label} lost`,
    });
  }
  if (service_minutes) {
    const time = formatMinutesRounded(service_minutes);
    figures.push({
      id: "service",
      figure: time,
      label: "service",
      spokenLabel: `${time} of service`,
    });
  }
  if (study_minutes) {
    const time = formatMinutesRounded(study_minutes);
    figures.push({
      id: "study",
      figure: time,
      label: "studied",
      spokenLabel: `${time} studied`,
    });
  }
  if (figures.length === 0) return null;
  return {
    range: weekRange(new Date(recap.start), new Date(recap.end)),
    figures,
    dismissKey: recap.end,
  };
}

/** The week's first and last day, "Nov 8 – Nov 14", in the reader's locale. */
export function weekRange(start: Date, end: Date): string {
  return formatWeekSpan(start, new Date(end.getTime() - 1));
}

/**
 * What a client stores for one dismissed recap: the chapter and the week, so
 * closing one chapter's recap leaves another's, and next week's, to show.
 */
export function recapDismissalKey(chapterId: string, card: RecapCard): string {
  return `${chapterId}@${card.dismissKey}`;
}

/** How many dismissals a client keeps: a few chapters' worth of this week. */
const KEPT_DISMISSALS = 8;

/** The stored list (space-separated keys) with `key` added, newest last, capped. */
export function withRecapDismissal(stored: string, key: string): string {
  const keys = stored.split(" ").filter((each) => each && each !== key);
  return [...keys, key].slice(-KEPT_DISMISSALS).join(" ");
}

/** Whether the stored list holds `key`. */
export function recapDismissed(stored: string | null, key: string): boolean {
  return (stored ?? "").split(" ").includes(key);
}
