import { useMemo } from "react";
import {
  EVENT_CREATE_PERMISSIONS,
  can,
  canAll,
  comingUpTracking,
  isModuleEnabled,
  type ComingUpDateTracking,
  type ComingUpEventCandidate,
  type ComingUpTaskCandidate,
} from "@repo/validation";
import { useEvents } from "./use-events";
import { useTasks } from "./use-tasks";
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
  };
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
