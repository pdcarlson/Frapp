import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { useIsMutating } from "@tanstack/react-query";
import type { ActivityRow } from "@repo/hooks";
import {
  useItemMenu,
  type ItemMenuAction,
  type ItemMenuHandle,
} from "@/components/item-actions-menu";
import { useEventMenu } from "@/lib/events/use-event-menu";
import { useCalendarTaskMenu } from "@/lib/tasks/use-task-menu";
import { useActivitySnoozeMenu } from "./activity-snooze";

/**
 * A row's long press on Activity (#5492; Paul, 2026-11-18: the menu "on task
 * and event rows everywhere they appear"): the glass menu the board's and the
 * Calendar's rows open, with the same actions to the same viewers, since it is
 * built by the same hooks (`useCalendarTaskMenu`'s `menuForTask`,
 * `useEventMenu`'s `menuForId`), plus Activity's own Snooze (#4982) where it
 * applied before: on a row that waits on the member, and Unsnooze under
 * Snoozed.
 *
 * - A task row offers that task's menu; a task for everyone the member
 *   assigned (one row, `task-group`) offers the group's, as the Calendar's
 *   group row does: Remove people, Duplicate, Delete for everyone.
 * - An event row offers Edit, Duplicate and Delete to whoever may use them.
 * - A row the hooks can't find (a task or event the viewer's lists don't
 *   hold) offers Snooze alone, or nothing.
 * - A row whose only action is Snooze or Unsnooze runs it on the long press,
 *   as it did before there was a menu: one row in a menu would be a step
 *   for nothing.
 *
 * Each action is also a named action for VoiceOver and TalkBack
 * (`itemMenuAccessibility`, through `ActivityListRow`).
 *
 * The task and event writes don't touch Activity's own read, so once a write
 * started from here (or anywhere while the screen is mounted) settles,
 * `onWrote` reads it again, and the row leaves or changes.
 *
 * Render `host` once in the screen, and `undoBar` outside its scroll, as the
 * Calendar does.
 */
export function useActivityRowMenu({ onWrote }: { onWrote: () => void }): {
  /** The To do list's, To review's, Waiting on others' and Links' rows. */
  menuFor: (row: ActivityRow) => ItemMenuHandle | null;
  /** A snoozed row: its item's actions, and Unsnooze. */
  wakeMenuFor: (row: ActivityRow) => ItemMenuHandle | null;
  /** An Archive row: its item's actions only; nothing there waits to snooze. */
  archiveMenuFor: (row: ActivityRow) => ItemMenuHandle | null;
  host: ReactNode;
  undoBar: ReactNode;
} {
  const taskMenu = useCalendarTaskMenu();
  const eventMenu = useEventMenu();
  const snoozeMenu = useActivitySnoozeMenu();
  const menu = useItemMenu();
  const { menuForTask } = taskMenu;
  const { menuForId: menuForEvent } = eventMenu;
  const { snoozeActionFor, wakeActionFor } = snoozeMenu;
  const { handleFor } = menu;

  useRereadAfterWrites(onWrote);

  /** The row's own item's actions: its task's, its group's or its event's. */
  const itemActions = useCallback(
    (row: ActivityRow): ItemMenuAction[] => {
      const handle =
        row.kind === "task"
          ? menuForTask(row.task.id, row.title)
          : row.kind === "task-group"
            ? menuForTask(row.group.task_id, row.title, "group")
            : row.kind === "event"
              ? menuForEvent(row.event.id)
              : null;
      return handle?.actions ?? [];
    },
    [menuForTask, menuForEvent],
  );

  const compose = useCallback(
    (row: ActivityRow, extra: ItemMenuAction | null): ItemMenuHandle | null => {
      const own = itemActions(row);
      if (own.length === 0) {
        // Snooze alone runs on the press, as before the menu (#4982).
        return extra
          ? { title: row.title, actions: [extra], open: () => extra.run() }
          : null;
      }
      return handleFor({
        title: row.title,
        actions: extra ? [...own, extra] : own,
      });
    },
    [itemActions, handleFor],
  );

  const menuFor = useCallback(
    (row: ActivityRow) => compose(row, snoozeActionFor(row)),
    [compose, snoozeActionFor],
  );
  const wakeMenuFor = useCallback(
    (row: ActivityRow) => compose(row, wakeActionFor(row)),
    [compose, wakeActionFor],
  );
  const archiveMenuFor = useCallback(
    (row: ActivityRow) => compose(row, null),
    [compose],
  );

  return {
    menuFor,
    wakeMenuFor,
    archiveMenuFor,
    host: (
      <>
        {menu.element}
        {taskMenu.host}
        {eventMenu.host}
      </>
    ),
    undoBar: taskMenu.undoBar,
  };
}

/** Whether a mutation is one of the task or event writes the menu starts. */
const isMenuWrite = (key: readonly unknown[] | undefined) =>
  key?.[0] === "tasks" || key?.[0] === "events";

/**
 * Calls `onWrote` each time the task and event writes in flight have all
 * settled: a menu's Mark done, Delete or Duplicate, or a save from the sheet
 * it opened.
 */
function useRereadAfterWrites(onWrote: () => void) {
  const writing = useIsMutating({
    predicate: (mutation) => isMenuWrite(mutation.options.mutationKey),
  });
  const was = useRef(writing);
  useEffect(() => {
    if (was.current > 0 && writing === 0) onWrote();
    was.current = writing;
  }, [writing, onWrote]);
}
