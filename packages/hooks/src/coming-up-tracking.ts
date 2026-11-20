import { useMemo } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  EVENT_CREATE_PERMISSIONS,
  can,
  canAll,
  comingUpPostReview,
  comingUpTracking,
  isModuleEnabled,
  type ComingUpDateTracking,
  type ComingUpEventCandidate,
  type ComingUpReviewRow,
  type ComingUpTaskCandidate,
  type MeetingContent,
} from "@repo/validation";
import { useAcceptAiSuggestion, useAiSuggestions } from "./use-ai-suggestions";
import { useEvents } from "./use-events";
import { useChapterRoster } from "./use-members";
import { useCreateTask, useTasks } from "./use-tasks";
import { useCurrentChapter } from "./use-chapters";
import { usePermissionList } from "./use-user";

/**
 * What already tracks each of a minutes' Coming up dates (#5672), for both
 * apps' date tiles: the event on that day and the tasks made for it, read
 * from the events and tasks the viewer can already open, and what the
 * viewer may make from a date. Nothing is read while the minutes have no
 * dates.
 */
export function useComingUpTracking(
  dates: readonly { date: string; text: string }[],
): {
  tracking: ComingUpDateTracking<
    ComingUpEventCandidate,
    ComingUpTaskCandidate
  >[];
  /**
   * The event and task create routes' own checks, module and grants, as the
   * quick actions gate them, so the menu never offers a form whose save is
   * refused: `POST /v1/events` needs the events module, `events:create` and
   * the controller's `members:view`; `POST /v1/tasks` the tasks module and
   * `tasks:manage` under the same `members:view`.
   */
  canCreateEvents: boolean;
  canManageTasks: boolean;
  /** The events and tasks have answered, so `tracking` is what the chapter has. */
  ready: boolean;
} {
  const enabled = dates.length > 0;
  const eventsQuery = useEvents({ enabled });
  const tasksQuery = useTasks({ enabled });
  const permissions = usePermissionList();
  const modules = useCurrentChapter().data?.enabled_modules;
  const tracking = useMemo(
    () =>
      comingUpTracking(dates, {
        events: readComingUpEvents(eventsQuery.data),
        tasks: readComingUpTasks(tasksQuery.data),
      }),
    [dates, eventsQuery.data, tasksQuery.data],
  );
  return {
    tracking,
    canCreateEvents:
      isModuleEnabled(modules, "events") &&
      canAll(EVENT_CREATE_PERMISSIONS, permissions),
    canManageTasks:
      isModuleEnabled(modules, "tasks") &&
      can("tasks:manage", permissions) &&
      can("members:view", permissions),
    // Fetching, not pending: a read its own rule holds off (no chapter
    // scope) never answers, and must not hold the review forever.
    ready: !eventsQuery.isFetching && !tasksQuery.isFetching,
  };
}

/**
 * The review that follows Post (#5672 step 3; Paul's pick, 2026-11-19): the
 * lines `comingUpPostReview` offers for just-posted minutes, once everything
 * they are read from has answered (the events, the tasks, the suggested
 * tasks posting made, the roster), and null until then. Empty for a poster
 * who can't make tasks, since every line would be refused.
 */
export function useComingUpPostReview(
  meetingId: string,
  content: Pick<MeetingContent, "dates" | "action_items">,
  enabled: boolean,
): ComingUpReviewRow[] | null {
  const dates = enabled ? content.dates : NO_DATES;
  const { tracking, canManageTasks, ready } = useComingUpTracking(dates);
  const suggestions = useAiSuggestions({
    source: { type: "meeting", id: meetingId },
    enabled: enabled && dates.length > 0,
  });
  const roster = useChapterRoster();
  const waiting = !ready || suggestions.isFetching || roster.isLoading;
  return useMemo(() => {
    if (!enabled) return null;
    if (dates.length === 0 || !canManageTasks) return [];
    if (waiting) return null;
    return comingUpPostReview({
      dates,
      tracking,
      actionItems: content.action_items,
      suggestions: (suggestions.data?.items ?? []).filter(
        (item) => item.kind === "task",
      ),
      members: roster.data ?? [],
    });
  }, [
    enabled,
    dates,
    canManageTasks,
    waiting,
    tracking,
    content.action_items,
    suggestions.data,
    roster.data,
  ]);
}

const NO_DATES: { date: string; text: string }[] = [];

/**
 * Makes what the poster left ticked, one line at a time: accepts the
 * suggested task a line's action item became (with the date's day, and the
 * poster as its owner when it named none), or makes the task. A line that
 * fails is counted and the rest still go; the answer says how many of each.
 */
export function useTrackComingUpDates() {
  const createTask = useCreateTask();
  const accept = useAcceptAiSuggestion();
  return useMutation({
    mutationKey: ["meetings", "coming-up", "track"],
    mutationFn: async ({
      rows,
      viewerId,
    }: {
      rows: readonly ComingUpReviewRow[];
      viewerId: string;
    }): Promise<{ made: number; failed: number }> => {
      let made = 0;
      let failed = 0;
      for (const row of rows) {
        if (row.kind !== "task") continue;
        const assigneeId = row.assigneeId ?? viewerId;
        try {
          if (row.suggestion) {
            const edits = {
              ...(row.suggestion.due_date === row.date
                ? {}
                : { due_date: row.date }),
              ...(row.suggestion.assignee_id === assigneeId
                ? {}
                : { assignee_id: assigneeId }),
            };
            await accept.mutateAsync({
              id: row.suggestion.id,
              ...(Object.keys(edits).length > 0 ? { task: edits } : {}),
            });
          } else {
            await createTask.mutateAsync({
              title: row.title,
              ...(row.description ? { description: row.description } : {}),
              assignee_id: assigneeId,
              due_date: row.date,
            });
          }
          made += 1;
        } catch {
          failed += 1;
        }
      }
      return { made, failed };
    },
  });
}

/**
 * The rows a date can be matched to, from reads typed loosely; a row missing
 * a field is skipped rather than trusted. Exported for its spec.
 */
export function readComingUpEvents(rows: unknown): ComingUpEventCandidate[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row: unknown) => {
    const r = (row ?? {}) as Record<string, unknown>;
    return typeof r.id === "string" &&
      typeof r.name === "string" &&
      typeof r.start_time === "string"
      ? [{ id: r.id, name: r.name, start_time: r.start_time }]
      : [];
  });
}

export function readComingUpTasks(rows: unknown): ComingUpTaskCandidate[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row: unknown) => {
    const r = (row ?? {}) as Record<string, unknown>;
    if (
      typeof r.id !== "string" ||
      typeof r.title !== "string" ||
      typeof r.due_date !== "string" ||
      typeof r.assignee_id !== "string"
    ) {
      return [];
    }
    return [
      {
        id: r.id,
        title: r.title,
        due_date: r.due_date,
        assignee_id: r.assignee_id,
        group_id: typeof r.group_id === "string" ? r.group_id : null,
      },
    ];
  });
}
