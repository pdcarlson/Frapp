"use client";

import { useQuery } from "@tanstack/react-query";
import type { components } from "@repo/api-sdk";
import { formatMinutesRounded } from "@repo/formatting";
import { createChapterQueryKeys } from "./chapter-query-keys";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";

export type ActivityStanding = components["schemas"]["ActivityStandingDto"];
export type ActivityStandingSection = ActivityStanding["unavailable"][number];

/** Chapter-scoped keys; the read is `activityStandingKeys.chapter(chapterId)`. */
export const activityStandingKeys = createChapterQueryKeys("activity-standing");

/**
 * The start of the member's week on this device: last Sunday at local
 * midnight. The phone's Study screen and More row count this week too
 * (`startOfWeek` in `apps/mobile/lib/study/format.ts` returns it).
 */
export function localWeekStart(now: Date = new Date()): Date {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  start.setDate(start.getDate() - start.getDay());
  return start;
}

/**
 * How the member is doing this semester (`GET /v1/activity/standing`,
 * `spec/behavior/activity.md` § Standing), for the top of Activity.
 *
 * Never fresh, as `useActivity` isn't: points, attendance and hours change on
 * other screens, none of which knows about this read, so it is read again
 * whenever the page mounts or the window regains focus.
 */
export function useActivityStanding(options: { enabled?: boolean } = {}) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: activityStandingKeys.chapter(chapterId!),
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/activity/standing", {
        params: {
          query: { week_start: localWeekStart().toISOString() },
        },
      });
      if (error) throw error;
      return data;
    },
    staleTime: 0,
    enabled: !!chapterId && (options.enabled ?? true),
  });
}

const SHORT_LABEL: Record<ActivityStandingSection, string> = {
  points: "Points",
  required_events: "Events",
  service: "Service",
  study: "Study",
};

/** One line of the standing: what it counts, the number, and its context. */
export interface StandingRow {
  id: ActivityStandingSection;
  label: string;
  /** The label in one word, for a gauge half a phone wide. */
  shortLabel: string;
  /** The number as drawn; `null` when the part couldn't be read. */
  value: string | null;
  /**
   * `value` in two pieces, for a gauge that draws the number large and its
   * target small (#4766): "45" and "of 150", "4h" and "of 10h". `target` is
   * `null` with nothing to measure against, `figure` when unreadable.
   */
  figure: string | null;
  target: string | null;
  /**
   * Nothing yet and nothing to aim at: zero points or hours with no goal, or
   * no required event so far. A row still lists it; a gauge strip leaves it
   * out (`activityStandingGauges`), since a bare zero says nothing.
   */
  empty: boolean;
  /** The line beside or under it, or `null` for none. */
  detail: string | null;
  /**
   * How full its meter is, 0 to 1, when the number has a target to measure
   * against; `null` draws no meter. Required events always have one (the
   * events themselves); points and hours have one when the chapter sets the
   * member a goal (#1062).
   */
  progress: number | null;
  /** For a screen reader: the row in one sentence. */
  spokenLabel: string;
}

/**
 * The standing as rows, in the order the page draws them. A part the chapter
 * has off is left out; one that couldn't be read stays, with no number, so
 * a failed read never looks like a zero.
 */
export function activityStandingRows(
  standing: ActivityStanding,
): StandingRow[] {
  const failed = new Set<ActivityStandingSection>(standing.unavailable);
  const rows: StandingRow[] = [];
  const unreadable = (id: ActivityStandingSection, label: string) =>
    rows.push({
      id,
      label,
      shortLabel: SHORT_LABEL[id],
      value: null,
      figure: null,
      target: null,
      empty: false,
      detail: "Couldn't load",
      progress: null,
      spokenLabel: `${label}: couldn't load`,
    });

  if (standing.points) {
    // `?? null`: an API from before goals (#1062) sends no goal at all.
    const { total, rank, ranked } = standing.points;
    const goal = standing.points.goal ?? null;
    const place = rank === null ? null : `#${rank} of ${ranked}`;
    const ranking = rank === null ? "" : `, ranked ${rank} of ${ranked}`;
    rows.push({
      id: "points",
      label: "Points",
      shortLabel: SHORT_LABEL.points,
      value: goal === null ? String(total) : `${total} of ${goal}`,
      figure: String(total),
      target: goal === null ? null : `of ${goal}`,
      empty: goal === null && total === 0,
      detail: place,
      progress: towards(total, goal),
      spokenLabel:
        goal === null
          ? `${total} ${total === 1 ? "point" : "points"} this semester${ranking}`
          : `${total} of ${goal} points this semester${ranking}`,
    });
  } else if (failed.has("points")) unreadable("points", "Points");

  if (standing.required_events) {
    const { required, attended, excused } = standing.required_events;
    const excusedLine = excused > 0 ? `${excused} excused` : null;
    rows.push({
      id: "required_events",
      label: "Required events",
      shortLabel: SHORT_LABEL.required_events,
      value: required === 0 ? "None yet" : `${attended} of ${required}`,
      figure: String(attended),
      target: `of ${required}`,
      empty: required === 0,
      detail: excusedLine,
      progress: required === 0 ? null : attended / required,
      spokenLabel:
        required === 0
          ? "No required events yet this semester"
          : `Attended ${attended} of ${required} required events this semester${
              excusedLine ? `, ${excusedLine}` : ""
            }`,
    });
  } else if (failed.has("required_events")) {
    unreadable("required_events", "Required events");
  }

  if (standing.service) {
    const { approved_minutes, pending_minutes } = standing.service;
    const goal_minutes = standing.service.goal_minutes ?? null;
    const approved = formatMinutesRounded(approved_minutes);
    const goal =
      goal_minutes === null ? null : formatMinutesRounded(goal_minutes);
    const pending =
      pending_minutes > 0
        ? `${formatMinutesRounded(pending_minutes)} pending`
        : null;
    rows.push({
      id: "service",
      label: "Service hours",
      shortLabel: SHORT_LABEL.service,
      value: goal === null ? approved : `${approved} of ${goal}`,
      figure: approved,
      target: goal === null ? null : `of ${goal}`,
      empty: goal === null && approved_minutes === 0 && pending_minutes === 0,
      detail: pending,
      progress: towards(approved_minutes, goal_minutes),
      spokenLabel: `${approved}${goal === null ? "" : ` of ${goal}`} of service approved this semester${
        pending ? `, ${pending}` : ""
      }`,
    });
  } else if (failed.has("service")) unreadable("service", "Service hours");

  if (standing.study) {
    const goal_minutes = standing.study.goal_minutes ?? null;
    const minutes = formatMinutesRounded(standing.study.minutes);
    const goal =
      goal_minutes === null ? null : formatMinutesRounded(goal_minutes);
    rows.push({
      id: "study",
      label: "Study hours",
      shortLabel: SHORT_LABEL.study,
      value: goal === null ? minutes : `${minutes} of ${goal}`,
      figure: minutes,
      target: goal === null ? null : `of ${goal}`,
      empty: goal === null && standing.study.minutes === 0,
      detail: "This week",
      progress: towards(standing.study.minutes, goal_minutes),
      spokenLabel: `${minutes}${goal === null ? "" : ` of ${goal}`} of study this week`,
    });
  } else if (failed.has("study")) unreadable("study", "Study hours");

  return rows;
}

/**
 * The standing as gauges, for the strip under the week card (#4766): the
 * rows, less the ones with nothing yet and nothing to aim at. A part that
 * couldn't be read stays, so a failed read never looks like nothing. Empty
 * when no gauge is left, and the strip is not drawn at all.
 */
export function activityStandingGauges(
  standing: ActivityStanding,
): StandingRow[] {
  return activityStandingRows(standing).filter((row) => !row.empty);
}

/** How far `done` is toward `goal`, 0 to 1, or `null` when there is no goal. */
function towards(done: number, goal: number | null | undefined): number | null {
  if (goal == null || !(goal > 0)) return null;
  return Math.min(1, Math.max(0, done / goal));
}
