import { useMemo } from "react";
import {
  comingUpTracking,
  type ComingUpDateTracking,
  type ComingUpEventCandidate,
  type ComingUpTaskCandidate,
} from "@repo/validation";
import { useEvents } from "./use-events";
import { useTasks } from "./use-tasks";

/**
 * What already tracks each of a minutes' Coming up dates (#5672), for both
 * apps' date tiles: the event on that day and the tasks made for it, read
 * from the events and tasks the viewer can already open. Nothing is read
 * while the minutes have no dates.
 */
export function useComingUpTracking(
  meetingId: string,
  dates: readonly { date: string; text: string }[],
): ComingUpDateTracking<ComingUpEventCandidate, ComingUpTaskCandidate>[] {
  const enabled = dates.length > 0;
  const eventsQuery = useEvents({ enabled });
  const tasksQuery = useTasks({ enabled });
  return useMemo(
    () =>
      comingUpTracking(dates, {
        meetingId,
        events: readEvents(eventsQuery.data),
        tasks: readTasks(tasksQuery.data),
      }),
    [dates, meetingId, eventsQuery.data, tasksQuery.data],
  );
}

/** The rows a date can be matched to; a row missing a field is skipped. */
function readEvents(rows: unknown): ComingUpEventCandidate[] {
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

function readTasks(rows: unknown): ComingUpTaskCandidate[] {
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
        status: typeof r.status === "string" ? r.status : null,
        meeting_id: typeof r.meeting_id === "string" ? r.meeting_id : null,
        group_id: typeof r.group_id === "string" ? r.group_id : null,
      },
    ];
  });
}
