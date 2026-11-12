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

/** One line of the standing: what it counts, the number, and its context. */
export interface StandingRow {
  id: ActivityStandingSection;
  label: string;
  /** The number as drawn; `null` when the part couldn't be read. */
  value: string | null;
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
      value: null,
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
      value: goal === null ? String(total) : `${total} of ${goal}`,
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
      value: required === 0 ? "None yet" : `${attended} of ${required}`,
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
      value: goal === null ? approved : `${approved} of ${goal}`,
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
      value: goal === null ? minutes : `${minutes} of ${goal}`,
      detail: "This week",
      progress: towards(standing.study.minutes, goal_minutes),
      spokenLabel: `${minutes}${goal === null ? "" : ` of ${goal}`} of study this week`,
    });
  } else if (failed.has("study")) unreadable("study", "Study hours");

  return rows;
}

/** How far `done` is toward `goal`, 0 to 1, or `null` when there is no goal. */
function towards(done: number, goal: number | null | undefined): number | null {
  if (goal == null || !(goal > 0)) return null;
  return Math.min(1, Math.max(0, done / goal));
}
