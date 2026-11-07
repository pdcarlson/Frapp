"use client";

import { useMemo } from "react";
import { CheckCircle2, Trash2, Undo2 } from "lucide-react";
import {
  useConfirmTask,
  useCreateTask,
  useCurrentUser,
  useDeleteTask,
  useEvents,
  useMembers,
  useMyPermissions,
  useNow,
  useRejectTask,
  useTasks,
  useUpdateTaskStatus,
} from "@repo/hooks";
import type { TaskStatus } from "@repo/hooks";
import { memberFallbackLabel, memberLabel } from "@repo/hooks/display-names";
import { formatWeekdayDay } from "@repo/formatting";
import { can } from "@repo/validation";
import { Button } from "@/components/ui/button";
import { useConfirmDialog } from "@/components/shared/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { NestedError, NestedOffline } from "@/components/shared/nested-states";
import { InlineNote } from "@/components/shared/inline-note";
import { SectionLabel } from "@/components/shared/section-label";
import { anyReadUncached } from "@/components/shared/async-states";
import { Can } from "@/components/shared/can";
import {
  SubscriptionNotice,
  type SubscriptionGate,
  useSubscriptionGate,
} from "@/components/shared/subscription-gate";
import { useToast } from "@/lib/hooks/use-toast";
import { useNetwork } from "@/lib/providers/network-provider";
import { useChapterModuleGateState } from "@/lib/hooks/use-chapter-module-gate";
import { actionStatus } from "@repo/hooks";
import { asArray, getErrorMessage } from "@/lib/utils";
import { taskDueClause } from "./task-due";
import { AddTaskRow, type TaskDraft } from "./add-task-row";
import { nextUpLine } from "./next-up";
import { TasksPageSkeleton } from "@/components/tasks/tasks-skeleton";

type Task = {
  id: string;
  chapter_id: string;
  title: string;
  description: string | null;
  assignee_id: string;
  created_by: string;
  due_date: string;
  /** Display status — `OVERDUE` when derived. Drives the column grouping. */
  status: TaskStatus;
  /**
   * The persisted status (#1051). Drives which action is offered: `OVERDUE`
   * renders identically for a stored `TODO` and a stored `IN_PROGRESS`, and the
   * server checks its transition table against this one. Optional because the
   * pre-#1051 API did not send it; falling back to `status` reproduces the old
   * behaviour, where an overdue task simply offered no action.
   */
  stored_status?: TaskStatus;
  point_reward: number | null;
  points_awarded: boolean;
  completed_at: string | null;
  confirmed_at: string | null;
  created_at: string;
};

/*
 * The four columns, each named by its section label and count. The
 * per-column descriptions ("Assignee is working on it.") and the empty-column
 * paragraphs are gone: the label already says what the column holds, and an
 * empty column needs one quiet line, not a tile explaining the workflow.
 */
const COLUMNS: {
  status: TaskStatus;
  label: string;
  empty: string;
}[] = [
  { status: "TODO", label: "To do", empty: "No tasks" },
  { status: "IN_PROGRESS", label: "In progress", empty: "No tasks" },
  { status: "COMPLETED", label: "Awaiting confirmation", empty: "No tasks" },
  { status: "OVERDUE", label: "Overdue", empty: "Nothing overdue" },
];

export function TasksBoard() {
  const { toast } = useToast();
  const { isOffline } = useNetwork();
  // Every write on this board (create, status, confirm, reject, delete) hits
  // `TaskController`, which carries no `@FreeTier`, so all five mirror one
  // paid-ops gate (#841). Reads stay ungated — the server guard returns early
  // for GET, and it remains the enforcement either way.
  const gate = useSubscriptionGate();
  const { confirm, confirmDialog } = useConfirmDialog();
  const tasksQuery = useTasks();
  const membersQuery = useMembers();
  const currentUser = useCurrentUser();
  const createTask = useCreateTask();
  const updateStatus = useUpdateTaskStatus();
  const confirmTask = useConfirmTask();
  const rejectTask = useRejectTask();
  const deleteTask = useDeleteTask();
  const permissionsQuery = useMyPermissions();
  const permissionsPayload = permissionsQuery.data;
  // `GET /v1/tasks` returns the whole chapter's board to `tasks:manage` and
  // only your own tasks to everyone else (`TaskController.list`).
  const canManage = can("tasks:manage", permissionsPayload?.permissions);
  const permissionsKnown = permissionsPayload !== undefined;
  // In flight with no answer yet: the one window where an empty board can't
  // tell an officer's columns from a member's line, so it draws neither for
  // that moment. A read that failed or can't run (offline) is not this: the
  // board draws its columns and the `<Can>` in To do says why the add row
  // isn't there, and retries after the outage.
  const permissionsLoading =
    !permissionsKnown && permissionsQuery.fetchStatus === "fetching";
  const moduleGate = useChapterModuleGateState();
  const nowTick = useNow();
  // A member with nothing assigned sees one line instead of the board, and
  // the line names the next event, so the read runs only for that member and
  // only when Events is on (the module guard would refuse it otherwise).
  const plateIsClear =
    permissionsKnown &&
    !canManage &&
    tasksQuery.data !== undefined &&
    asArray<Task>(tasksQuery.data).length === 0;
  const eventsOn =
    moduleGate.status === "ready" && moduleGate.isModuleEnabled("events");
  const eventsQuery = useEvents({ enabled: plateIsClear && eventsOn });

  const tasks = useMemo(
    () => asArray<Task>(tasksQuery.data),
    [tasksQuery.data],
  );
  const members = useMemo(() => membersQuery.data ?? [], [membersQuery.data]);
  const membersByUserId = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of members) {
      if (m.user_id)
        map.set(String(m.user_id), memberLabel(m.display_name, m.user_id));
    }
    return map;
  }, [members]);

  // Since #560 the status mutations write the list entry in `onMutate`, so a
  // row re-renders into its next status immediately — "Mark complete" can now
  // appear under the cursor while the Start PATCH is still in flight, and a
  // fast second tap sends a transition the server will reject (the table in
  // `task.service.ts` is checked against the *stored* status). The chat card
  // already folds these in; the board did not.
  const lifecycleWritePending =
    updateStatus.isPending || confirmTask.isPending || rejectTask.isPending;

  const columns = useMemo(() => {
    const grouped = new Map<TaskStatus, Task[]>();
    for (const column of COLUMNS) {
      grouped.set(column.status, []);
    }
    for (const task of tasks) {
      const bucket = grouped.get(task.status);
      if (bucket) bucket.push(task);
    }
    for (const [, list] of grouped) {
      list.sort((a, b) => {
        const aMs = new Date(a.due_date).getTime();
        const bMs = new Date(b.due_date).getTime();
        return aMs - bMs;
      });
    }
    return grouped;
  }, [tasks]);

  // Resolves whether the task was created, so the add row knows to clear.
  async function createFromDraft(draft: TaskDraft): Promise<boolean> {
    try {
      await createTask.mutateAsync(draft);
      toast({
        title: "Task created",
        description: `${draft.title} is now assigned.`,
      });
      return true;
    } catch (error) {
      toast({
        title: "Couldn't create task",
        description: getErrorMessage(
          error,
          "Retry in a moment or confirm the assignee is a chapter member.",
        ),
        variant: "destructive",
      });
      return false;
    }
  }

  async function changeStatus(task: Task, next: TaskStatus) {
    try {
      await updateStatus.mutateAsync({
        id: task.id,
        body: { status: next },
      });
      toast({
        title: "Status updated",
        description: `${task.title} → ${next}.`,
      });
    } catch (error) {
      toast({
        title: "Couldn't update task",
        description: getErrorMessage(
          error,
          "The API rejected the transition. Only the assignee or admins can move tasks.",
        ),
        variant: "destructive",
      });
    }
  }

  async function confirmCompletion(task: Task) {
    try {
      await confirmTask.mutateAsync(task.id);
      toast({
        title: "Task confirmed",
        description: task.point_reward
          ? `${task.point_reward} points awarded to the assignee.`
          : "Completion confirmed.",
      });
    } catch (error) {
      toast({
        title: "Couldn't confirm task",
        description: getErrorMessage(error, "Try again in a moment."),
        variant: "destructive",
      });
    }
  }

  async function rejectCompletion(task: Task) {
    const result = await confirm({
      title: `Reject completion of "${task.title}"?`,
      description:
        "The task goes back to IN_PROGRESS and the assignee is notified to keep working.",
      confirmLabel: "Reject completion",
      tone: "destructive",
      comment: {
        label: "Comment for the assignee",
        placeholder: "Optional. What still needs doing?",
      },
    });
    // `null` is cancel; a confirmed empty box is still a rejection, which is the
    // distinction `window.prompt` carried and the dialog preserves.
    if (result === null) return;
    try {
      await rejectTask.mutateAsync({
        id: task.id,
        body: { comment: result.comment || undefined },
      });
      toast({
        title: "Task moved back to In progress",
        description: "The assignee was told to keep working on it.",
      });
    } catch (error) {
      toast({
        title: "Couldn't reject task",
        description: getErrorMessage(error, "Try again in a moment."),
        variant: "destructive",
      });
    }
  }

  async function removeTask(task: Task) {
    const confirmed = await confirm({
      title: `Delete "${task.title}"?`,
      description: "This can't be undone.",
      confirmLabel: "Delete task",
      tone: "destructive",
    });
    if (!confirmed) return;
    try {
      await deleteTask.mutateAsync(task.id);
      toast({
        title: "Task deleted",
        description: `${task.title} was removed.`,
      });
    } catch (error) {
      toast({
        title: "Couldn't delete task",
        description: getErrorMessage(error, "Try again in a moment."),
        variant: "destructive",
      });
    }
  }

  /*
   * README §4 item 4: a network-dependent async view ships an offline state.
   * This screen had none, so a disconnected member sat on the loading
   * skeleton until the query gave up. Copy is writing.md §7's row.
   */
  /*
   * `currentUser` is in this gate because the board deliberately has no early
   * return for it: the Confirm gate below fails closed on an unresolved
   * viewer, so an uncached `/v1/users/me` hides Confirm on *every* row with no
   * notice saying why (the cost that comment names, tracked as #1346).
   * Offline that read may be paused rather than errored (`anyReadUncached`
   * has the two cases), and nothing else would catch a paused one.
   * `membersQuery` is here for the same reason its assignee labels need it.
   */
  if (isOffline && anyReadUncached(tasksQuery, membersQuery, currentUser)) {
    return (
      <div className="space-y-6">
        <NestedOffline
          sole
          title="Tasks unavailable offline"
          description="Reconnect to load the chapter board and move tasks through it."
          onRetry={() => {
            void tasksQuery.refetch();
            void membersQuery.refetch();
            void currentUser.refetch();
          }}
        />
      </div>
    );
  }

  /*
   * The board's states come from the nested family with `sole`: the
   * whole-screen family paints `--card`, which on a flush route redraws the
   * card the board deleted (README § Page grammar). `sole` keeps the live
   * region and the heading each state is this page's only one of.
   */
  if (tasksQuery.isPending) {
    return <TasksPageSkeleton />;
  }

  // Only swap the whole board out when there is nothing to show. v5 keeps the
  // last good payload alongside `isError`, and since the optimistic rework
  // (#560) a *failed* mutation reconciles through `onSettled` too — so an
  // action that fails offline triggers a refetch that also fails, and gating
  // on `isError` alone would replace a fully populated, readable board with an
  // error page every time.
  if (tasksQuery.isError && !tasksQuery.data) {
    return (
      <div className="space-y-6">
        <NestedError
          sole
          title="Couldn't load tasks"
          description="Confirm your chapter access and retry."
          onRetry={() => void tasksQuery.refetch()}
        />
      </div>
    );
  }

  const myUserId = (currentUser.data as { id?: string } | undefined)?.id ?? "";

  return (
    <div className="space-y-6">
      {/*
        For every viewer, not only `tasks:manage`: the assignee-facing Start /
        Mark complete controls are gated too, so a member with no manage
        permission still needs the explanation for why their own board went
        read-only.
      */}
      <SubscriptionNotice gate={gate} feature="managing tasks" />

      {plateIsClear ? (
        /*
          Done is one line (rule 7): a member's board with nothing on it is
          four empty columns, so the line takes its place, and says what's
          next rather than only what isn't there.
        */
        <InlineNote>
          {nextUpLine(eventsOn ? eventsQuery.data : undefined, nowTick)}
        </InlineNote>
      ) : permissionsLoading && tasks.length === 0 ? null : (
        /*
          Flush, not carded. Each column used to be a `<Card>` with a title,
          a description and (under Awaiting confirmation) a footer explaining
          the confirm rule. A column is now a section on the page surface,
          named by its label and count; the tiles inside keep a hairline frame,
          because a kanban tile is a block with its own controls, not a row.
        */
        <div className="grid gap-x-6 gap-y-8 md:grid-cols-2 xl:grid-cols-4">
          {COLUMNS.map((column) => {
            const list = columns.get(column.status) ?? [];
            const labelId = `tasks-column-${column.status.toLowerCase()}`;
            return (
              <section
                key={column.status}
                aria-labelledby={labelId}
                className="min-w-0 space-y-3"
              >
                <SectionLabel id={labelId} count={list.length}>
                  {column.label}
                </SectionLabel>
                {/*
                  Rule 2: the first action sits where the first item goes.
                  The add row is the board's only way to create a task, so
                  it stays at the top of To do once the column fills up.
                */}
                {column.status === "TODO" &&
                (canManage || !permissionsKnown) ? (
                  <Can permission="tasks:manage">
                    <AddTaskRow
                      members={members}
                      gate={gate}
                      pending={createTask.isPending}
                      onCreate={createFromDraft}
                    />
                  </Can>
                ) : null}
                {list.length === 0 ? (
                  column.status === "TODO" && canManage ? null : (
                    <p className="text-sm text-muted-foreground">
                      {column.empty}
                    </p>
                  )
                ) : (
                  <ul className="space-y-2">
                    {list.map((task) => (
                      <TaskTile
                        key={task.id}
                        task={task}
                        assigneeName={
                          membersByUserId.get(task.assignee_id) ??
                          memberFallbackLabel(task.assignee_id)
                        }
                        myUserId={myUserId}
                        gate={gate}
                        lifecycleWritePending={lifecycleWritePending}
                        onChangeStatus={(next) => void changeStatus(task, next)}
                        onConfirm={() => void confirmCompletion(task)}
                        onReject={() => void rejectCompletion(task)}
                        onDelete={() => void removeTask(task)}
                      />
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
      {confirmDialog}
    </div>
  );
}

function TaskTile({
  task,
  assigneeName,
  myUserId,
  gate,
  lifecycleWritePending,
  onChangeStatus,
  onConfirm,
  onReject,
  onDelete,
}: {
  task: Task;
  assigneeName: string;
  myUserId: string;
  gate: SubscriptionGate;
  lifecycleWritePending: boolean;
  onChangeStatus: (next: TaskStatus) => void;
  onConfirm: () => void;
  onReject: () => void;
  onDelete: () => void;
}) {
  // Fails closed. `myUserId` is "" while `useCurrentUser` is in flight or
  // errored, which would otherwise make `isMine` false for every row and put
  // Confirm back on your own task — the flip-and-revert this gate exists to
  // stop. Treat an unknown viewer as "might be me".
  //
  // Note the cost, which is deliberate but not free: the board has no early
  // return for `currentUser`, so if `GET /v1/users/me` fails terminally,
  // Confirm stays hidden on *every* row with no notice saying why, and an
  // officer may read it as a revoked grant. Hiding a control the server would
  // accept is the safer failure than offering one it will refuse, but the
  // missing explanation is tracked in #1346.
  const viewerUnknown = myUserId === "";
  const isMine = !viewerUnknown && task.assignee_id === myUserId;
  const cannotConfirm = isMine || viewerUnknown;
  const due = taskDueClause(task);
  const status = actionStatus(task);

  return (
    <li className="rounded-[14px] border border-border p-3">
      <p className="text-sm font-semibold text-foreground">{task.title}</p>
      {task.description ? (
        <p className="mt-1 line-clamp-2 text-caption text-muted-foreground">
          {task.description}
        </p>
      ) : null}
      {/*
        One `·`-joined meta line. An absent fact drops out of it rather than
        leaving a separator behind (README § Page grammar).
      */}
      <div className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-caption text-muted-foreground">
        {due ? (
          <>
            <span
              className={due.overdue ? "text-destructive-text" : undefined}
              title={formatWeekdayDay(task.due_date) ?? undefined}
            >
              {due.text}
            </span>
            <span aria-hidden="true">·</span>
          </>
        ) : null}
        <span className="min-w-0 truncate">{assigneeName}</span>
        {task.point_reward ? (
          <Badge className="ml-1">+{task.point_reward} pts</Badge>
        ) : null}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {/*
          The inline status controls are writes too
          (`PATCH /v1/tasks/:id/status`), so they mirror the same gate as
          Create — gating only the header trigger would claim writes are
          blocked while still offering four of them.
        */}
        {isMine && status === "TODO" ? (
          <Button
            size="toolbar"
            variant="secondary"
            {...gate.controlProps(lifecycleWritePending)}
            onClick={() => onChangeStatus("IN_PROGRESS")}
          >
            Start
          </Button>
        ) : null}
        {isMine && status === "IN_PROGRESS" ? (
          <Button
            size="toolbar"
            variant="secondary"
            {...gate.controlProps(lifecycleWritePending)}
            onClick={() => onChangeStatus("COMPLETED")}
          >
            Mark complete
          </Button>
        ) : null}
        <Can permission="tasks:manage">
          {status === "COMPLETED" ? (
            <>
              {/*
               * The *live* Confirm is hidden on your own task: the API refuses
               * a self-confirmation (#1056), so rendering it would offer an
               * action guaranteed to 403 — and the optimistic write would flip
               * the label to "Confirmed" and snap back. The already-awarded
               * button is kept: it is disabled and reads "Confirmed", so it
               * reports state rather than offering an action, and an
               * assignee-admin would otherwise lose any sign their task was
               * confirmed. Reject stays throughout: it withholds points rather
               * than awarding them, so the server rule does not cover it.
               */}
              {cannotConfirm && !task.points_awarded ? null : (
                <Button
                  size="toolbar"
                  className="gap-1.5"
                  onClick={onConfirm}
                  {...gate.controlProps(
                    task.points_awarded || lifecycleWritePending,
                  )}
                >
                  <CheckCircle2 className="h-4 w-4" />
                  {task.points_awarded ? "Confirmed" : "Confirm"}
                </Button>
              )}
              <Button
                size="toolbar"
                variant="secondary"
                className="gap-1.5"
                {...gate.controlProps(lifecycleWritePending)}
                onClick={onReject}
              >
                <Undo2 className="h-4 w-4" />
                Reject
              </Button>
            </>
          ) : null}
          {/*
            A square icon at the trailing edge, so the tile's lifecycle
            actions lead and Delete never reads as one of them, and Confirm,
            Reject and Delete fit one row of a narrow column. Named for the
            task, since every tile has one.
          */}
          <Button
            size="toolbar"
            variant="ghost"
            className="ml-auto w-9 px-0 pointer-coarse:w-11 pointer-coarse:px-0"
            aria-label={`Delete ${task.title}`}
            {...gate.controlProps()}
            onClick={onDelete}
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </Button>
        </Can>
      </div>
      {/*
        The one rule from the old column footer worth keeping: it explains a
        missing control, so it sits on the tile whose control is missing. Only
        on a known own task; while the viewer is unresolved the sentence would
        be a guess (#1346).
      */}
      <Can permission="tasks:manage">
        {isMine && status === "COMPLETED" && !task.points_awarded ? (
          <p className="mt-2 text-caption text-muted-foreground">
            You can&apos;t confirm your own task.
          </p>
        ) : null}
      </Can>
    </li>
  );
}
