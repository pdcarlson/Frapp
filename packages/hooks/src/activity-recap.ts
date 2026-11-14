"use client";

import { useQuery } from "@tanstack/react-query";
import type { components } from "@repo/api-sdk";
import { formatMinutesRounded } from "@repo/formatting";
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
 * `spec/behavior/activity.md` § Recap), for the card at the top of Activity
 * in the first days of the next one. Read only then: the rest of the week
 * the card isn't drawn and the read isn't made.
 *
 * A finished week changes only when something is backdated (an officer
 * approving last week's hours, a late point award), so it is read once per
 * visit to the page and kept for five minutes.
 */
export function useActivityRecap(options: { enabled?: boolean } = {}) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: activityRecapKeys.chapter(chapterId!),
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/activity/recap", {
        params: {
          query: { week_start: localWeekStart().toISOString() },
        },
      });
      if (error) throw error;
      return data;
    },
    staleTime: 5 * 60 * 1000,
    enabled: !!chapterId && recapInSeason() && (options.enabled ?? true),
  });
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
  /** The week it sums up, as the card's subtitle: "Nov 8 – 14". */
  range: string;
  figures: RecapFigure[];
  /**
   * What a dismissal is remembered by: the end of the week it sums up, so
   * dismissing this week's recap leaves next week's to show.
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
export function activityRecapCard(recap: ActivityRecap): RecapCard | null {
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

/** "Nov 8 – 14", or "Oct 25 – Nov 1" across a month: the week's first and last day. */
export function weekRange(start: Date, end: Date): string {
  const last = new Date(end.getTime() - 1);
  const month = (date: Date) =>
    date.toLocaleDateString("en-US", { month: "short" });
  const first = `${month(start)} ${start.getDate()}`;
  return month(start) === month(last)
    ? `${first} – ${last.getDate()}`
    : `${first} – ${month(last)} ${last.getDate()}`;
}
