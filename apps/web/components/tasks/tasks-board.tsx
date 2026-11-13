"use client";

import { describeLoadFailure } from "@repo/hooks/error-copy";
import { useMemo, useState } from "react";
import {
  Camera,
  CheckCircle2,
  Link2,
  Pencil,
  Trash2,
  Undo2,
} from "lucide-react";
import {
  isFirstAiReadInFlight,
  useAiSuggestions,
  useConfirmTask,
  useCreateTask,
  useCurrentUser,
  useDeleteTask,
  useEvents,
  useMembers,
  useMyPermissions,
  useNow,
  useRejectTask,
  useChapterScope,
  useTasks,
  useUpdateTaskStatus,
} from "@repo/hooks";
import type { LiveTaskPhoto, TaskStatus, TaskSubtask } from "@repo/hooks";
import { memberFallbackLabel, memberLabel } from "@repo/hooks/display-names";
import { formatDayTime, formatWeekdayDay, nextUpLine } from "@repo/formatting";
import { can, taskNeedsSignOff, type TaskProofKind } from "@repo/validation";
import { ToastAction } from "@/components/ui/toast";
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
import {
  TASK_ACTION_LABELS,
  TASK_CONFIRMED_LABEL,
  TASK_DONE_LABEL,
  TASK_NEEDS_CHANGES_LABEL,
  TASK_STATUS_LABELS,
  isSentBack,
  actionStatus,
  canReopenOwnTask,
} from "@repo/hooks";
import { asArray, cn, getErrorMessage } from "@/lib/utils";
import { taskDueClause } from "./task-due";
import { TaskSubtaskList, TaskSubtasksToggle } from "./task-subtasks";
import { TaskEditForm } from "./task-edit-form";
import {
  MarkDoneControl,
  SendBackDialog,
  TaskProof,
  type CompletionProof,
} from "./task-photo";
import { AddTaskRow, type TaskDraft } from "./add-task-row";
import { TasksPageSkeleton } from "@/components/tasks/tasks-skeleton";
import { SuggestedTasks } from "@/components/ai/suggested-tasks";
import { ListLayoutToggle } from "@/components/shared/list-layout-toggle";
import { useListLayout, type ListLayout } from "@/lib/list-layout";

type Task = {
  id: string;
  chapter_id: string;
  title: string;
  description: string | null;
  assignee_id: string;
  created_by: string;
  due_date: string;
  /** The moment it is due, when it has a time of day (#4003). */
  due_at?: string | null;
  /** Its checklist, in order (#4003). */
  subtasks?: TaskSubtask[];
  /** Task photos, reference then proof (#4635). */
  photos?: LiveTaskPhoto[];
  /** What Mark done needs (#4635). */
  proof_kind?: TaskProofKind;
  proof_link?: string | null;
  /** When an officer last sent it back, and why (#4635). */
  sent_back_at?: string | null;
  sent_back_reason?: string | null;
  completion_note?: string | null;
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
 * The four columns, each named by its section label and count, in the shared
 * words every task surface uses (`TASK_STATUS_LABELS`, `@repo/hooks`), so a
 * task reads the same here as on mobile and on its chat card. The third
 * column holds only completions an officer still has to confirm: confirmed
 * ones leave it for the Confirmed list under the board, or "Waiting on an
 * officer" would go on listing work nobody is waiting on. The
 * per-column descriptions ("Assignee is working on it.") and the empty-column
 * paragraphs are gone: the label already says what the column holds, and an
 * empty column needs one quiet line, not a tile explaining the workflow.
 */
const COLUMNS: {
  status: TaskStatus;
  label: string;
  empty: string;
}[] = [
  { status: "TODO", label: TASK_STATUS_LABELS.TODO, empty: "No tasks" },
  {
    status: "IN_PROGRESS",
    label: TASK_STATUS_LABELS.IN_PROGRESS,
    empty: "No tasks",
  },
  {
    status: "COMPLETED",
    label: TASK_STATUS_LABELS.COMPLETED,
    empty: "Nothing to confirm",
  },
  {
    status: "OVERDUE",
    label: TASK_STATUS_LABELS.OVERDUE,
    empty: "Nothing overdue",
  },
];

/**
 * Confirmed tasks the Confirmed list shows before "Show all". Every one stays
 * reachable (it is where an officer deletes an old task), but a semester of
 * them shouldn't lengthen the page under the columns by default.
 */
const CONFIRMED_PREVIEW = 4;

/** Newest confirmation first; a row missing both stamps sorts last. */
function confirmedAt(task: Task): number {
  const at = Date.parse(task.confirmed_at ?? task.completed_at ?? "");
  return Number.isNaN(at) ? 0 : at;
}

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
  // `none`: the server can't scope the read, so `useTasks` never sends it (#4094).
  const chapterScope = useChapterScope();
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
  // Suggested tasks (#4313) sit above the columns for an officer who has
  // some. The board waits for that read with its own, so the columns are
  // drawn once and never pushed down by a list arriving late. A server with
  // AI off answers at once with none. Only a read in flight holds the
  // board: one that can't run (offline) or failed once leaves the columns
  // to draw, as the permissions read above does, rather than wait out the
  // retries.
  const suggestionsQuery = useAiSuggestions({ enabled: canManage });
  const suggestionsLoading =
    canManage && isFirstAiReadInFlight(suggestionsQuery);
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
  // row re-renders into its next status immediately — "Mark done" can now
  // appear under the cursor while the Start PATCH is still in flight, and a
  // fast second tap sends a transition the server will reject (the table in
  // `task.service.ts` is checked against the *stored* status). The chat card
  // already folds these in; the board did not.
  const lifecycleWritePending =
    updateStatus.isPending || confirmTask.isPending || rejectTask.isPending;

  const [showAllConfirmed, setShowAllConfirmed] = useState(false);
  // Grid is the board of status columns, the page's only view until #4175
  // and still its default; List is the same groups as rows, top to bottom.
  const [layout] = useListLayout("tasks");
  const isGrid = layout === "grid";

  const { columns, confirmed } = useMemo(() => {
    const grouped = new Map<TaskStatus, Task[]>();
    for (const column of COLUMNS) {
      grouped.set(column.status, []);
    }
    const recent: Task[] = [];
    for (const task of tasks) {
      if (task.status === "COMPLETED" && task.points_awarded) {
        recent.push(task);
        continue;
      }
      const bucket = grouped.get(task.status);
      if (bucket) bucket.push(task);
    }
    recent.sort((a, b) => confirmedAt(b) - confirmedAt(a));
    for (const [, list] of grouped) {
      list.sort((a, b) => {
        // By day, then by time within the day, a task with no time last
        // (it is due by the end of the day).
        const byDay = a.due_date.localeCompare(b.due_date);
        if (byDay !== 0) return byDay;
        const aMs = a.due_at ? Date.parse(a.due_at) : Number.POSITIVE_INFINITY;
        const bMs = b.due_at ? Date.parse(b.due_at) : Number.POSITIVE_INFINITY;
        return aMs === bMs ? 0 : aMs < bMs ? -1 : 1;
      });
    }
    return { columns: grouped, confirmed: recent };
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

  async function changeStatus(
    task: Task,
    next: TaskStatus,
    proof?: CompletionProof,
  ) {
    const reopening = actionStatus(task) === "COMPLETED";
    try {
      await updateStatus.mutateAsync({
        id: task.id,
        body: { status: next, ...(proof ?? {}) },
      });
      if (next === "COMPLETED") {
        // The undo a stray click needs (owner audit 2026-11-06, P6.1). The
        // API lets the assignee take back their own completion until an
        // officer confirms it, so Undo is a real write, not a delayed one.
        toast({
          title: "Marked done",
          // A task with no points and no proof is Done as marked (#4635).
          description: taskNeedsSignOff(task)
            ? `${task.title} is waiting on an officer to confirm it.`
            : task.title,
          action: (
            <ToastAction
              altText={`${TASK_ACTION_LABELS.reopen}: ${task.title}`}
              onClick={() =>
                void changeStatus(
                  { ...task, status: "COMPLETED", stored_status: "COMPLETED" },
                  "IN_PROGRESS",
                )
              }
            >
              Undo
            </ToastAction>
          ),
        });
      } else {
        toast({
          title: reopening ? "Moved back to In progress" : "Started",
          description: task.title,
        });
      }
    } catch (error) {
      toast({
        title: "Couldn't update task",
        description: getErrorMessage(
          error,
          "Only the person it's assigned to, or an officer, can move this task.",
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

  // Send back asks for a reason in its own sheet (#4635).
  const [sendingBack, setSendingBack] = useState<Task | null>(null);
  function rejectCompletion(task: Task) {
    setSendingBack(task);
  }

  async function sendBack(
    task: Task,
    body: { comment: string; require_photo?: boolean },
  ) {
    await rejectTask.mutateAsync({ id: task.id, body });
    toast({
      title: "Sent back",
      description: `${task.title} went back to its assignee with your reason.`,
    });
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
  // Before the pending gate: a read that never goes out stays pending, and
  // the skeleton would never end. Worded as chat's no-chapter pane is.
  if (chapterScope === "none") {
    return <InlineNote>Pick an active chapter to load its tasks.</InlineNote>;
  }

  if (tasksQuery.isPending || suggestionsLoading) {
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
          description={describeLoadFailure(tasksQuery.error)}
          onRetry={() => void tasksQuery.refetch()}
        />
      </div>
    );
  }

  const myUserId = (currentUser.data as { id?: string } | undefined)?.id ?? "";

  return (
    // A container (#4022): beside chat (#3779) the page is narrow while the
    // window is wide, so the layout counts the page's own width. In Grid, one
    // lane per row below `@2xl` (672px), two to `@4xl` (896px), then all
    // four; List stacks the groups at every width.
    <div className="@container space-y-6">
      {/*
        For every viewer, not only `tasks:manage`: the assignee-facing Start /
        Mark complete controls are gated too, so a member with no manage
        permission still needs the explanation for why their own board went
        read-only.
      */}
      <SubscriptionNotice gate={gate} feature="managing tasks" />

      {canManage ? <SuggestedTasks headingId="tasks-suggested" /> : null}

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
          a description and (under the completed column) a footer explaining
          the confirm rule. A column is now a section on the page surface,
          named by its label and count. In Grid the tiles inside keep a
          hairline frame, because a kanban tile is a block with its own
          controls; in List they are flush rows split by a hairline (#4175).
        */
        <>
          {/*
            The List / Grid switch at the trailing edge, over the groups it
            lays out (Linear's and Asana's List / Board sit there too).
          */}
          <div className="flex justify-end">
            <ListLayoutToggle screen="tasks" />
          </div>
          <div
            className={
              isGrid
                ? "grid gap-x-6 gap-y-8 @2xl:grid-cols-2 @4xl:grid-cols-4"
                : "space-y-8"
            }
          >
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
                    <ul className={taskListClassName(layout)}>
                      {list.map((task) => (
                        <TaskCard
                          key={task.id}
                          layout={layout}
                          task={task}
                          assigneeName={
                            membersByUserId.get(task.assignee_id) ??
                            memberFallbackLabel(task.assignee_id)
                          }
                          myUserId={myUserId}
                          canManage={canManage}
                          gate={gate}
                          lifecycleWritePending={lifecycleWritePending}
                          onChangeStatus={(next, proof) =>
                            void changeStatus(task, next, proof)
                          }
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
        </>
      )}

      {/*
        Confirmed tasks, under the columns rather than in them: they are
        finished, so they are the quietest thing on the page, and the Waiting
        on an officer column stays the officer's queue. Newest first, the
        latest few by default, every one a click away (Delete lives on the
        tile).
      */}
      {confirmed.length > 0 ? (
        <section aria-labelledby="tasks-confirmed" className="space-y-3">
          <SectionLabel id="tasks-confirmed" count={confirmed.length}>
            {TASK_CONFIRMED_LABEL}
          </SectionLabel>
          <ul
            className={
              isGrid
                ? "grid gap-x-6 gap-y-2 @2xl:grid-cols-2 @4xl:grid-cols-4"
                : taskListClassName(layout)
            }
          >
            {(showAllConfirmed
              ? confirmed
              : confirmed.slice(0, CONFIRMED_PREVIEW)
            ).map((task) => (
              <TaskCard
                key={task.id}
                layout={layout}
                task={task}
                assigneeName={
                  membersByUserId.get(task.assignee_id) ??
                  memberFallbackLabel(task.assignee_id)
                }
                myUserId={myUserId}
                canManage={canManage}
                gate={gate}
                lifecycleWritePending={lifecycleWritePending}
                onChangeStatus={(next) => void changeStatus(task, next)}
                onConfirm={() => void confirmCompletion(task)}
                onReject={() => void rejectCompletion(task)}
                onDelete={() => void removeTask(task)}
              />
            ))}
          </ul>
          {confirmed.length > CONFIRMED_PREVIEW ? (
            <Button
              size="toolbar"
              variant="ghost"
              className="justify-self-start"
              onClick={() => setShowAllConfirmed((open) => !open)}
            >
              {showAllConfirmed ? "Show fewer" : `Show all ${confirmed.length}`}
            </Button>
          ) : null}
        </section>
      ) : null}

      {confirmDialog}
      <SendBackDialog
        title={sendingBack?.title ?? ""}
        proofKind={sendingBack?.proof_kind}
        open={sendingBack !== null}
        onClose={() => setSendingBack(null)}
        onSubmit={(body) =>
          sendingBack ? sendBack(sendingBack, body) : Promise.resolve()
        }
      />
    </div>
  );
}

/**
 * A task group's list: in Grid a stack of framed tiles, in List flush rows
 * split by a hairline, as the Documents and Directory lists are.
 */
function taskListClassName(layout: ListLayout): string {
  return layout === "grid" ? "space-y-2" : "divide-y divide-border";
}

/**
 * One task, as a tile in a Grid column or a row of the List (#4175). Both
 * draw the same facts and the same controls, Edit and Delete included, from
 * this one body; only the frame and where the controls sit differ.
 */
function TaskCard({
  layout,
  task,
  assigneeName,
  myUserId,
  canManage,
  gate,
  lifecycleWritePending,
  onChangeStatus,
  onConfirm,
  onReject,
  onDelete,
}: {
  layout: ListLayout;
  task: Task;
  assigneeName: string;
  myUserId: string;
  /** Holds `tasks:manage`: may check off and edit anyone's subtasks. */
  canManage: boolean;
  gate: SubscriptionGate;
  lifecycleWritePending: boolean;
  onChangeStatus: (next: TaskStatus, proof?: CompletionProof) => void;
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
  const { toast } = useToast();
  const viewerUnknown = myUserId === "";
  const isMine = !viewerUnknown && task.assignee_id === myUserId;
  const cannotConfirm = isMine || viewerUnknown;
  const due = taskDueClause(task);
  const status = actionStatus(task);
  const [subtasksOpen, setSubtasksOpen] = useState(false);
  // An officer's edit replaces the tile with the task form until it saves or
  // is cancelled (#4296). A confirmed task's points were paid on it as it
  // stood, so it has no Edit.
  const [editing, setEditing] = useState(false);
  const editable = canManage && !task.points_awarded;
  // No points and no proof: Done as marked, nothing to confirm (#4635).
  const needsSignOff = taskNeedsSignOff(task);
  const sentBack = isSentBack(task);
  const isRow = layout === "list";

  if (editing && editable) {
    return (
      <li
        aria-label={`Editing ${task.title}`}
        className={cn(
          "rounded-[14px] border border-ring/60 p-3",
          isRow && "my-2",
        )}
        // Escape puts the tile back unsaved, like the + card's Escape. A
        // picker open inside handles its own Escape in its portal first.
        onKeyDown={(event) => {
          if (event.key === "Escape" && !event.defaultPrevented) {
            event.stopPropagation();
            setEditing(false);
          }
        }}
      >
        <TaskEditForm
          task={task}
          assigneeName={assigneeName}
          gate={gate}
          onClose={() => setEditing(false)}
        />
      </li>
    );
  }

  const summary = (
    <div className="min-w-0 flex-1">
      <p className="text-sm font-semibold text-foreground">{task.title}</p>
      {task.description ? (
        <p
          className={cn(
            "mt-1 text-caption text-muted-foreground",
            // A row stays one line of description; a tile has the height.
            isRow ? "line-clamp-1" : "line-clamp-2",
          )}
        >
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
              title={
                (task.due_at
                  ? formatDayTime(task.due_at)
                  : formatWeekdayDay(task.due_date)) ?? undefined
              }
            >
              {due.text}
            </span>
            <span aria-hidden="true">·</span>
          </>
        ) : null}
        <span className="min-w-0 truncate">{assigneeName}</span>
        {/* No `·` before it: its checklist icon separates it, the way
            Todoist's sub-task count sits, so a wrapped line never starts or
            ends on a dangling dot. */}
        {task.subtasks && task.subtasks.length > 0 ? (
          <TaskSubtasksToggle
            subtasks={task.subtasks}
            open={subtasksOpen}
            onToggle={() => setSubtasksOpen((open) => !open)}
          />
        ) : null}
        {task.point_reward ? (
          <Badge className="ml-1">+{task.point_reward} pts</Badge>
        ) : null}
        {task.proof_kind && task.proof_kind !== "none" && status !== "COMPLETED" ? (
          <Badge variant="outline" className="ml-1 gap-1">
            {task.proof_kind === "photo" ? (
              <Camera className="h-3 w-3" aria-hidden="true" />
            ) : (
              <Link2 className="h-3 w-3" aria-hidden="true" />
            )}
            {task.proof_kind === "photo" ? "Photo required" : "Link required"}
          </Badge>
        ) : null}
        {sentBack ? (
          <Badge variant="warning" className="ml-1">
            {TASK_NEEDS_CHANGES_LABEL}
          </Badge>
        ) : null}
        {status === "COMPLETED" && !needsSignOff && task.points_awarded ? (
          <Badge variant="success" className="ml-1">
            {TASK_DONE_LABEL}
          </Badge>
        ) : null}
      </div>
      <TaskProof
        task={task}
        showProof={isMine || canManage}
        sentBack={sentBack}
      />
    </div>
  );

  const controls = (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2",
        // A row with nothing to offer this viewer draws no empty gap.
        // In a row they end it, wrapping within its trailing half on a
        // narrow page rather than taking a line of their own under it.
        isRow ? "empty:hidden max-w-[55%] justify-end" : "mt-3",
      )}
    >
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
          {TASK_ACTION_LABELS.start}
        </Button>
      ) : null}
      {isMine && status === "IN_PROGRESS" ? (
        <MarkDoneControl
          title={task.title}
          label={TASK_ACTION_LABELS.complete}
          task={task}
          sentBack={sentBack}
          controlProps={gate.controlProps(lifecycleWritePending)}
          onComplete={(proof) => onChangeStatus("COMPLETED", proof)}
          onUploadError={(message) =>
            toast({
              title: "Couldn't add the photo",
              description: message,
              variant: "destructive",
            })
          }
        />
      ) : null}
      {/*
          The assignee taking back their own "done" until an officer confirms
          it. Ghost, not secondary: it is the rare move on this tile.
        */}
      {canReopenOwnTask({
        stored: status,
        pointsAwarded: task.points_awarded,
        isAssignee: isMine,
        needsSignOff,
      }) ? (
        <Button
          size="toolbar"
          variant="ghost"
          {...gate.controlProps(lifecycleWritePending)}
          onClick={() => onChangeStatus("IN_PROGRESS")}
        >
          {TASK_ACTION_LABELS.reopen}
        </Button>
      ) : null}
      <Can permission="tasks:manage">
        {status === "COMPLETED" && (!task.points_awarded || !needsSignOff) ? (
          <>
            {/*
             * Hidden on your own task: the API refuses a self-confirmation
             * (#1056), so rendering it would offer an action guaranteed to
             * 403, and the optimistic write would flip the label to
             * "Confirmed" and snap back. A confirmed task carries neither
             * control: it sits in the Confirmed list, which says so, and the
             * API refuses a reject once points are awarded. Reject stays on
             * your own unconfirmed task: it withholds points rather than
             * awarding them, so the self-confirm rule does not cover it.
             */}
            {cannotConfirm || !needsSignOff ? null : (
              <Button
                size="toolbar"
                className="gap-1.5"
                onClick={onConfirm}
                {...gate.controlProps(lifecycleWritePending)}
              >
                <CheckCircle2 className="h-4 w-4" />
                {TASK_ACTION_LABELS.confirm}
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
              {TASK_ACTION_LABELS.reject}
            </Button>
          </>
        ) : null}
        {/*
            A square icon at the trailing edge, so the tile's lifecycle
            actions lead and Delete never reads as one of them, and Confirm,
            Reject and Delete fit one row of a narrow column. Named for the
            task, since every tile has one.
          */}
        {editable ? (
          <Button
            size="toolbar"
            variant="ghost"
            className="ml-auto w-9 px-0 pointer-coarse:w-11 pointer-coarse:px-0"
            aria-label={`Edit ${task.title}`}
            {...gate.controlProps()}
            onClick={() => setEditing(true)}
          >
            <Pencil className="h-4 w-4" aria-hidden="true" />
          </Button>
        ) : null}
        <Button
          size="toolbar"
          variant="ghost"
          className={cn(
            "w-9 px-0 pointer-coarse:w-11 pointer-coarse:px-0",
            !editable && "ml-auto",
          )}
          aria-label={`Delete ${task.title}`}
          {...gate.controlProps()}
          onClick={onDelete}
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </Button>
      </Can>
    </div>
  );

  const subtaskList =
    subtasksOpen && task.subtasks && task.subtasks.length > 0 ? (
      <TaskSubtaskList
        taskId={task.id}
        subtasks={task.subtasks}
        canCheck={isMine || canManage}
        canEdit={canManage}
        closed={task.points_awarded}
        gate={gate}
      />
    ) : null;

  return (
    <li className={isRow ? "py-3" : "rounded-[14px] border border-border p-3"}>
      {isRow ? (
        // The row's facts lead and its controls end it, as a Linear list
        // row's do; an opened checklist spans the row under both.
        <>
          <div className="flex items-start gap-3 @xl:gap-4">
            {summary}
            {controls}
          </div>
          {subtaskList}
        </>
      ) : (
        // The tile as it always was: the checklist opens under the meta line
        // that holds its toggle, and the controls end the tile.
        <>
          {summary}
          {subtaskList}
          {controls}
        </>
      )}
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
