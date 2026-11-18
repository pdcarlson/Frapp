import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AccessibilityInfo, Alert } from "react-native";
import { useRouter } from "expo-router";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import {
  TASK_ACTION_LABELS,
  useDeleteTask,
  usePermissionList,
  useTasks,
  useViewerUserId,
} from "@repo/hooks";
import type { CalendarTask } from "@repo/hooks/calendar-tasks";
import { can } from "@repo/validation";
import {
  CheckGlyph,
  CopyGlyph,
  MinusGlyph,
  PencilGlyph,
  PersonGlyph,
  PlayGlyph,
  TrashGlyph,
  UndoGlyph,
} from "@/components/control-glyphs";
import {
  useItemMenu,
  type ItemMenuAction,
  type ItemMenuHandle,
} from "@/components/item-actions-menu";
import { NewTaskSheet } from "@/components/tasks/new-task-sheet";
import { UndoBar } from "@/components/tasks/undo-bar";
import { alertFailure } from "@/lib/failure-alert";
import type { TaskRowModel } from "@/lib/tasks/board";
import { useStartTask } from "@/lib/tasks/use-start-task";
import { useTaskRowById } from "@/lib/tasks/use-task-row-by-id";
import {
  editTargetOfRow,
  taskCreatedLine,
  taskDuplicateOf,
  type TaskEditTarget,
  type TaskPrefill,
} from "@/lib/tasks/create-task";
import {
  confirmTaskDelete,
  groupCopies,
  taskMenuKeys,
  taskScreenControls,
  type TaskMenuKey,
} from "@/lib/tasks/task-screen";
import { markDoneLabel } from "@/lib/tasks/task-photos";
import {
  MarkDoneHost,
  useTaskToggle,
  type TaskToggle,
} from "@/lib/tasks/use-task-toggle";

/**
 * A task row's long-press menu (#5492; Paul, 2026-11-18): Mark done, Edit,
 * Reassign, Remove people, Duplicate and Delete, each to the viewer the API
 * lets use it. The rows are `taskMenuKeys`' over the task screen's own
 * `taskScreenControls`, so the menu and the screen can't disagree; what each
 * row does is the screen's too:
 *
 * - Mark done and Mark not done are the screen's `useTaskToggle`, the board's
 *   checkbox, so a task that asks for proof opens Mark done's sheet and a
 *   completion offers the same Undo. A screen with no checkbox of its own
 *   (the Calendar) takes `useCalendarTaskMenu`, which brings its own.
 * - Start is the assignee's To do → In progress (`useStartTask`), as chat's
 *   task card and the task screen's More offer it.
 * - Edit and Reassign open the board's edit sheet (New task in edit mode),
 *   Reassign with Assign to's picker over it.
 * - Remove people opens the task's screen in its select mode (`select=1`).
 * - Duplicate opens New task filled in from the task (`taskDuplicateOf`).
 * - Delete asks the task screen's question (`confirmTaskDelete`) and sends
 *   one copy's delete, or every copy's for Delete for everyone.
 *
 * Render `host` once in the screen.
 */
export function useTaskMenu({
  toggles: toggle,
  onCreated,
}: {
  /** The screen's Mark done (`useTaskToggle`), whose sheet it hosts. */
  toggles: TaskToggle;
  /** Said where the screen says a create landed (the board's line). */
  onCreated?: (line: string) => void;
}): {
  menuFor: (row: TaskRowModel) => ItemMenuHandle | null;
  /** A Calendar row: one task, or every copy of a group task the viewer gave. */
  menuForCalendarTask: (item: CalendarTask) => ItemMenuHandle | null;
  /**
   * A task by id, read off the viewer's tasks: one copy, or (`group`) every
   * copy of the group it belongs to, as Activity's one row for a task for
   * everyone. `null` when the read doesn't hold it.
   */
  menuForTask: TaskMenuForTask;
  host: ReactNode;
} {
  const router = useRouter();
  const viewerId = useViewerUserId();
  const canManage = can("tasks:manage", usePermissionList());
  const { data: tasksData } = useTasks();
  const deleteTask = useDeleteTask();
  const menu = useItemMenu();

  const rowById = useTaskRowById();

  // Edit and Reassign: one sheet per edit, gone once it closes, so its
  // fields start from the task as it stands (the task screen's way).
  const editRef = useRef<BottomSheetModal>(null);
  const [editing, setEditing] = useState<{
    target: TaskEditTarget;
    who: boolean;
    at: Date;
  } | null>(null);
  useEffect(() => {
    if (editing) editRef.current?.present();
  }, [editing]);

  // Duplicate: New task, one sheet per press.
  const duplicateRef = useRef<BottomSheetModal>(null);
  const [duplicating, setDuplicating] = useState<{
    key: number;
    prefill: TaskPrefill;
    at: Date;
  } | null>(null);
  useEffect(() => {
    if (duplicating) duplicateRef.current?.present();
  }, [duplicating]);

  const runDelete = useCallback(
    (row: TaskRowModel, everyone: boolean) => {
      // One copy's Delete never names the group: only Delete for everyone
      // sends `scope=group`.
      deleteTask
        .mutateAsync(everyone ? { id: row.id, scope: "group" } : row.id)
        .catch((error: unknown) =>
          alertFailure({
            title: "Couldn't delete the task",
            error,
            fallback: "Try again.",
          }),
        );
    },
    [deleteTask],
  );

  const startTask = useStartTask();

  const actionFor = useCallback(
    (key: TaskMenuKey, row: TaskRowModel): ItemMenuAction => {
      switch (key) {
        case "markDone":
          return {
            key,
            label: markDoneLabel(TASK_ACTION_LABELS.complete, row.proofKind),
            glyph: (color) => <CheckGlyph color={color} />,
            run: () => void toggle.toggle(row),
          };
        case "start":
          return {
            key,
            label: TASK_ACTION_LABELS.start,
            glyph: (color) => <PlayGlyph color={color} />,
            run: () => startTask(row.id),
          };
        case "reopen":
          return {
            key,
            label: TASK_ACTION_LABELS.reopen,
            glyph: (color) => <UndoGlyph color={color} />,
            run: () => void toggle.toggle(row),
          };
        case "edit":
        case "reassign":
          return {
            key,
            label: key === "edit" ? "Edit" : "Reassign",
            glyph: (color) =>
              key === "edit" ? (
                <PencilGlyph color={color} />
              ) : (
                <PersonGlyph color={color} />
              ),
            run: () => {
              const target = editTargetOfRow(row);
              if (target) {
                setEditing({ target, who: key === "reassign", at: new Date() });
              }
            },
          };
        case "removePeople":
          return {
            key,
            label: "Remove people",
            glyph: (color) => <MinusGlyph color={color} />,
            run: () =>
              router.push({
                pathname: "/task-details",
                params: { id: row.id, select: "1" },
              }),
          };
        case "duplicate":
          return {
            key,
            label: "Duplicate",
            glyph: (color) => <CopyGlyph color={color} />,
            run: () => {
              const at = new Date();
              setDuplicating((previous) => ({
                key: (previous?.key ?? 0) + 1,
                prefill: taskDuplicateOf(
                  row,
                  groupCopies(tasksData, row.groupId),
                  at,
                ),
                at,
              }));
            },
          };
        case "delete":
        case "deleteForEveryone": {
          const everyone = key === "deleteForEveryone";
          return {
            key,
            label: everyone ? "Delete for everyone" : "Delete",
            destructive: true,
            glyph: (color) => <TrashGlyph color={color} />,
            run: () =>
              confirmTaskDelete(row.title, everyone, () =>
                runDelete(row, everyone),
              ),
          };
        }
      }
    },
    [toggle, router, tasksData, runDelete, startTask],
  );

  const build = useCallback(
    (
      row: TaskRowModel,
      title: string,
      scope: "copy" | "group",
    ): ItemMenuHandle | null => {
      const controls = taskScreenControls({
        row,
        viewerId,
        canManage,
        toggleRefused: toggle.refusal !== null,
      });
      const keys = taskMenuKeys(controls, scope).filter(
        // Mid-write, the box is held; so are the menu's status moves.
        (key) =>
          (key !== "markDone" && key !== "start" && key !== "reopen") ||
          toggle.canToggle(row),
      );
      return menu.handleFor({
        title,
        actions: keys.map((key) => actionFor(key, row)),
      });
    },
    [viewerId, canManage, toggle, menu, actionFor],
  );

  const menuFor = useCallback(
    (row: TaskRowModel) => build(row, row.title, "copy"),
    [build],
  );

  const menuForTask = useCallback<TaskMenuForTask>(
    (id, title, scope = "copy") => {
      const row = rowById(id);
      if (!row) return null;
      // A copy with no group can't stand for one.
      return build(row, title, row.groupId === null ? "copy" : scope);
    },
    [rowById, build],
  );

  const menuForCalendarTask = useCallback(
    (item: CalendarTask): ItemMenuHandle | null => {
      if (item.kind === "mine") {
        const row = rowById(item.taskId);
        return row ? build(row, item.title, "copy") : null;
      }
      const rows = item.assignees
        .map((assignee) => rowById(assignee.taskId))
        .filter((row): row is TaskRowModel => row !== null);
      const first = rows[0];
      if (!first) return null;
      if (item.assignees.length === 1) return build(first, item.title, "copy");
      // Several copies on one row act together only as a group task's;
      // separate tasks that share a title and day can't be acted on at once.
      const oneGroup =
        first.groupId !== null &&
        rows.length === item.assignees.length &&
        rows.every((row) => row.groupId === first.groupId);
      return oneGroup ? build(first, item.title, "group") : null;
    },
    [rowById, build],
  );

  const host = (
    <>
      {menu.element}
      {editing ? (
        <NewTaskSheet
          key={`${editing.target.id}-${editing.at.getTime()}`}
          ref={editRef}
          now={editing.at}
          editing={editing.target}
          openOnWho={editing.who}
          // The task screen's kept edit (#4872): the same task's Edit there
          // opens on what was typed here.
          keptDraft={`task-edit:${editing.target.id}`}
          onClosed={() => setEditing(null)}
        />
      ) : null}
      {duplicating ? (
        <NewTaskSheet
          key={`duplicate-${duplicating.key}`}
          ref={duplicateRef}
          now={duplicating.at}
          prefill={duplicating.prefill}
          offerGroups
          onCreated={(assigneeName, wasSelf, upForGrabs) => {
            const line = taskCreatedLine(assigneeName, wasSelf, upForGrabs);
            onCreated?.(line);
            AccessibilityInfo.announceForAccessibility(line);
          }}
          onClosed={() => setDuplicating(null)}
        />
      ) : null}
    </>
  );

  return { menuFor, menuForCalendarTask, menuForTask, host };
}

/** `useTaskMenu`'s menu for a task by id (`menuForTask`). */
export type TaskMenuForTask = (
  id: string,
  title: string,
  scope?: "copy" | "group",
) => ItemMenuHandle | null;

/**
 * The task menu for a screen with no checkbox (the Calendar, its Day screen
 * and Activity): its own Mark done, with Mark done's sheet and Undo, and a failed
 * one said in the platform alert, since the screen has no line for it.
 *
 * `host` holds the menu and the sheets, which draw over everything, so it
 * can sit anywhere in the screen. `undoBar` floats over the screen's bottom
 * edge, so it goes outside the screen's scroll (beside `ScreenShell`, as the
 * board places its own), or it would sit against the scrolling content.
 */
export function useCalendarTaskMenu(): {
  menuForCalendarTask: (item: CalendarTask) => ItemMenuHandle | null;
  menuForTask: TaskMenuForTask;
  host: ReactNode;
  undoBar: ReactNode;
  /** Which offer the bar holds, new with each completion; `null` with none. */
  undoKey: number | null;
} {
  const viewerId = useViewerUserId();
  const toggles = useTaskToggle(useTaskRowById(), { viewerId });
  const { menuForCalendarTask, menuForTask, host } = useTaskMenu({ toggles });
  const line = toggles.refusal ?? toggles.notice;
  useEffect(() => {
    if (line) Alert.alert(line);
  }, [line]);
  return {
    menuForCalendarTask,
    menuForTask,
    host: (
      <>
        {host}
        <MarkDoneHost toggle={toggles} />
      </>
    ),
    undoBar: toggles.undo ? (
      <UndoBar
        key={toggles.undo.key}
        message={toggles.undo.message}
        onUndo={() => void toggles.takeBack(toggles.undo!.id)}
      />
    ) : null,
    undoKey: toggles.undo?.key ?? null,
  };
}
