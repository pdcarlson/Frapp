"use client";

import { describeLoadFailure } from "@repo/hooks/error-copy";
import { useMemo, useState } from "react";
import {
  Camera,
  CheckCircle2,
  Link2,
  ChevronDown,
  Pencil,
  Trash2,
  Undo2,
  Users,
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
  MY_TASKS_GROUPS,
  MY_TASKS_GROUP_EMPTY,
  MY_TASKS_GROUP_LABELS,
  TASK_DUE_BUCKET_LABELS,
  TASK_DUE_FILTERS,
  compareTasksByDue,
  myTasksGroup,
  taskDueBucket,
  type TaskDueBucket,
} from "@repo/hooks";
import type {
  LiveTaskPhoto,
  TaskEditScope,
  TaskStatus,
  TaskSubtask,
} from "@repo/hooks";
import { memberFallbackLabel, memberLabel } from "@repo/hooks/display-names";
import {
  formatDayTime,
  formatPointsChip,
  formatWeekdayDay,
  nextUpLine,
} from "@repo/formatting";
import {
  TASK_AUDIENCE_COPY,
  TASK_SERIES_SCOPE_COPY,
  can,
  taskNeedsSignOff,
  taskSignedOffAutomatically,
  type TaskProofKind,
  type TaskSeriesLine,
} from "@repo/validation";
import { ToastAction } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { useConfirmDialog } from "@/components/shared/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { NestedError, NestedOffline } from "@/components/shared/nested-states";
import { InlineNote } from "@/components/shared/inline-note";
import { StaleReadNotice } from "@/components/shared/stale-read-notice";
import { SectionLabel } from "@/components/shared/section-label";
import { anyReadUncached } from "@/components/shared/async-states";
import { Can } from "@/components/shared/can";
import {
  SubscriptionNotice,
  type SubscriptionGate,
  useSubscriptionGate,
} from "@/components/shared/subscription-gate";
import { toastFailure } from "@/lib/failure-toast";
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
import { TaskRepeatLine } from "./task-repeat";
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
import { FilterChip, type FilterOption } from "@/components/shared/filter-chip";
import { SegmentedChoice } from "@/components/ui/segmented";
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
  /** How it repeats, on a copy of a repeating task (#5119). */
  series?: TaskSeriesLine | null;
  /** The task for everyone this is one member's copy of (#4295 step 3). */
  group_id?: string | null;
  /** A task for everyone's progress over all its copies, as the API counts it. */
  group?: { total: number; done: number } | null;
};

/**
 * A task for everyone on the chapter's status board (#4295 step 3): its
 * copies still to finish drawn as one tile, "14 of 20 done", the way Google
 * Classroom shows one assignment with its turned-in count rather than a row
 * per student. A copy marked done leaves it for Waiting on an officer, where
 * it is confirmed like any task.
 */
type GroupTileData = {
  id: string;
  /** One open copy, read for what every copy shares. */
  sample: Task;
  /** The copies still to finish, soonest due first. */
  open: Task[];
  total: number;
  done: number;
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
 * One group the page draws: a status lane, a My tasks day range, or a
 * person. `id` names its label element (`tasks-column-<id>`).
 */
type TaskGroup = {
  id: string;
  label: string;
  empty: string;
  tasks: Task[];
  /** Tasks for everyone drawn in this lane, ahead of its tasks. */
  groupTiles?: GroupTileData[];
};

/** Not marked done yet: what a group tile still counts as open. */
function isOpenStatus(status: TaskStatus): boolean {
  return status !== "COMPLETED";
}

/**
 * Whose tasks the page shows (#4295 step 5). A member's read holds only their
 * own, so they always see My tasks; an officer switches between their own and
 * the chapter's board, which stays where they land, as before.
 */
type TasksView = "mine" | "all";
/** How the chapter's board groups: its status lanes, or one group a person. */
type TasksGroupBy = "status" | "person";
/** The Status filter: a lane's status, or the Confirmed list. */
type StatusFilter = TaskStatus | "CONFIRMED";
type DueFilter = Exclude<TaskDueBucket, "earlier">;

const VIEW_OPTIONS = [
  { value: "mine", label: "My tasks" },
  { value: "all", label: "All tasks" },
] as const;

const GROUP_BY_OPTIONS = [
  { value: "status", label: "By status" },
  { value: "person", label: "By person" },
] as const;

const STATUS_FILTER_ORDER: StatusFilter[] = [
  "TODO",
  "IN_PROGRESS",
  "COMPLETED",
  "OVERDUE",
  "CONFIRMED",
];

function statusFilterLabel(value: StatusFilter): string {
  return value === "CONFIRMED"
    ? TASK_CONFIRMED_LABEL
    : TASK_STATUS_LABELS[value];
}

/** Finished and confirmed: it leaves the lanes for the Confirmed list. */
function isConfirmedRow(task: Task): boolean {
  return task.status === "COMPLETED" && task.points_awarded;
}

function statusOf(task: Task): StatusFilter {
  return isConfirmedRow(task) ? "CONFIRMED" : task.status;
}

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

  // Read here, ahead of the early returns, because My tasks needs it to pick
  // an officer's own rows out of the chapter's board.
  const myUserId = (currentUser.data as { id?: string } | undefined)?.id ?? "";

  const [officerView, setOfficerView] = useState<TasksView>("all");
  // While permissions are unknown (the read failed) the page can't tell an
  // officer from a member, so it keeps the status board it always drew,
  // with no switch or chips, and the add row says why it isn't there.
  const view: TasksView = canManage
    ? officerView
    : permissionsKnown
      ? "mine"
      : "all";
  const [groupBy, setGroupBy] = useState<TasksGroupBy>("status");
  const [assigneeFilter, setAssigneeFilter] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter | null>(null);
  const [dueFilter, setDueFilter] = useState<DueFilter | null>(null);
  // The filters belong to the chapter's board; My tasks ignores them.
  const filtering =
    view === "all" &&
    (assigneeFilter !== null || statusFilter !== null || dueFilter !== null);
  function clearFilters() {
    setAssigneeFilter(null);
    setStatusFilter(null);
    setDueFilter(null);
  }

  // The filter chips list only values some task on the board has (the
  // filter chip's rule, `components.md` § 4).
  const filterOptions = useMemo(() => {
    const now = new Date(nowTick);
    const assignees = new Set<string>();
    const statuses = new Set<StatusFilter>();
    const dues = new Set<TaskDueBucket>();
    for (const task of tasks) {
      assignees.add(task.assignee_id);
      statuses.add(statusOf(task));
      dues.add(taskDueBucket(task, now));
    }
    // A value already picked stays listed, and named, after its last task
    // leaves (marked done, deleted, or past midnight), so the chip never
    // falls back to the raw value and the member can see what to clear.
    if (assigneeFilter !== null) assignees.add(assigneeFilter);
    if (statusFilter !== null) statuses.add(statusFilter);
    if (dueFilter !== null) dues.add(dueFilter);
    const assignee: FilterOption[] = [...assignees]
      .map((id) => ({
        value: id,
        label:
          id === myUserId
            ? "You"
            : (membersByUserId.get(id) ?? memberFallbackLabel(id)),
      }))
      .sort((a, b) =>
        a.value === myUserId
          ? -1
          : b.value === myUserId
            ? 1
            : a.label.localeCompare(b.label),
      );
    const status: FilterOption[] = STATUS_FILTER_ORDER.filter((value) =>
      statuses.has(value),
    ).map((value) => ({ value, label: statusFilterLabel(value) }));
    const due: FilterOption[] = TASK_DUE_FILTERS.filter((value) =>
      dues.has(value),
    ).map((value) => ({
      value,
      label:
        value === "overdue"
          ? TASK_DUE_BUCKET_LABELS.overdue
          : `Due ${TASK_DUE_BUCKET_LABELS[value].toLowerCase()}`,
    }));
    return { assignee, status, due };
  }, [
    tasks,
    membersByUserId,
    myUserId,
    nowTick,
    assigneeFilter,
    statusFilter,
    dueFilter,
  ]);

  const { groups, confirmed, shown } = useMemo(() => {
    const now = new Date(nowTick);
    const nameOf = (id: string) =>
      membersByUserId.get(id) ?? memberFallbackLabel(id);
    let pool: Task[];
    if (view === "mine") {
      // Only the viewer's own, whatever the read holds: an officer's is the
      // chapter's, and so is one previewing a role without `tasks:manage`
      // (View as a role keeps the officer's reads). Until the account is
      // known an officer gets none (the page says why) and a member gets the
      // read, which the server already keeps to their own.
      pool =
        myUserId !== ""
          ? tasks.filter((task) => task.assignee_id === myUserId)
          : canManage
            ? []
            : tasks;
    } else {
      pool = tasks.filter(
        (task) =>
          (assigneeFilter === null || task.assignee_id === assigneeFilter) &&
          (statusFilter === null || statusOf(task) === statusFilter) &&
          (dueFilter === null || taskDueBucket(task, now) === dueFilter),
      );
    }

    const recent = pool.filter(isConfirmedRow);
    recent.sort((a, b) => confirmedAt(b) - confirmedAt(a));
    const live = pool.filter((task) => !isConfirmedRow(task));

    let drawn: TaskGroup[];
    if (view === "mine") {
      // Today (overdue first), This week and Later hold what is still to
      // do; what waits on an officer is done from the member's side, so it
      // follows them, as Asana's My tasks moves finished work out of the
      // day lists.
      drawn = MY_TASKS_GROUPS.map((group) => ({
        id: group,
        label: MY_TASKS_GROUP_LABELS[group],
        empty: MY_TASKS_GROUP_EMPTY[group],
        tasks: live.filter(
          (task) =>
            task.status !== "COMPLETED" && myTasksGroup(task, now) === group,
        ),
      }));
      drawn.push({
        id: "waiting",
        label: TASK_STATUS_LABELS.COMPLETED,
        empty: "Nothing waiting",
        tasks: live.filter((task) => task.status === "COMPLETED"),
      });
    } else if (groupBy === "person") {
      // One group a person who has an unconfirmed task, by name, as Linear
      // groups a board by assignee. Nobody with nothing open gets an empty
      // group: in a chapter of sixty that would be most of the page.
      const byPerson = new Map<string, Task[]>();
      for (const task of live) {
        const list = byPerson.get(task.assignee_id) ?? [];
        list.push(task);
        byPerson.set(task.assignee_id, list);
      }
      drawn = [...byPerson.entries()]
        .map(([id, list]) => ({
          id: `person-${id}`,
          label: id === myUserId ? `${nameOf(id)} (you)` : nameOf(id),
          empty: "No tasks",
          tasks: list,
        }))
        .sort((a, b) => a.label.localeCompare(b.label));
    } else {
      // The four status lanes. A Status filter keeps its own lane alone (or
      // none, for Confirmed, which lives under the lanes).
      // A task for everyone's open copies fold into one tile (#4295 step 3),
      // in Overdue once any copy is, otherwise in To do, where it was made.
      // A filter shows copies one by one, since it asks about members.
      const tiles = new Map<string, GroupTileData>();
      if (!filtering) {
        for (const task of tasks) {
          if (!task.group_id) continue;
          const tile = tiles.get(task.group_id) ?? {
            id: task.group_id,
            sample: task,
            open: [],
            total: 0,
            done: 0,
          };
          tile.total += 1;
          if (isOpenStatus(task.status)) tile.open.push(task);
          else tile.done += 1;
          tiles.set(task.group_id, tile);
        }
      }
      const folded = (task: Task) =>
        !!task.group_id &&
        isOpenStatus(task.status) &&
        tiles.has(task.group_id);
      const openTiles = [...tiles.values()].filter(
        (tile) => tile.open.length > 0,
      );
      for (const tile of openTiles) {
        tile.open.sort(compareTasksByDue);
        tile.sample = tile.open[0]!;
        // The API's count covers every copy, loaded on this page or not.
        if (tile.sample.group) {
          tile.total = tile.sample.group.total;
          tile.done = tile.sample.group.done;
        }
      }
      const overdueTile = (tile: GroupTileData) =>
        tile.open.some((task) => task.status === "OVERDUE");
      drawn = COLUMNS.filter(
        (column) => statusFilter === null || column.status === statusFilter,
      ).map((column) => ({
        id: column.status.toLowerCase(),
        label: column.label,
        empty: column.empty,
        tasks: live.filter(
          (task) => task.status === column.status && !folded(task),
        ),
        groupTiles:
          column.status === "TODO"
            ? openTiles.filter((tile) => !overdueTile(tile))
            : column.status === "OVERDUE"
              ? openTiles.filter(overdueTile)
              : [],
      }));
    }
    for (const group of drawn) {
      group.tasks.sort(compareTasksByDue);
      group.groupTiles?.sort((a, b) => compareTasksByDue(a.sample, b.sample));
    }
    return { groups: drawn, confirmed: recent, shown: pool.length };
  }, [
    tasks,
    filtering,
    view,
    groupBy,
    assigneeFilter,
    statusFilter,
    dueFilter,
    canManage,
    myUserId,
    membersByUserId,
    nowTick,
  ]);

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
  ): Promise<boolean> {
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
      toastFailure({
        title: "Couldn't update task",
        error,
        fallback:
          "Only the person it's assigned to, or an officer, can move this task.",
        // No Try again: Mark done's proof dialog and the board's controls
        // act on this function's answer, and a retry from the toast would
        // land with them still showing the failure. Their control is back
        // and is the retry.
      });
      return false;
    }
    return true;
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
      toastFailure({
        title: "Couldn't confirm task",
        error,
        fallback: "Try again in a moment.",
        retry: () => confirmCompletion(task),
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

  /** Delete everyone's copy of a task for everyone (#4295 step 3). */
  async function removeGroup(tile: GroupTileData) {
    const confirmed = await confirm({
      title: `Delete "${tile.sample.title}" for everyone?`,
      description:
        "Every member's copy goes, including ones already marked done. This can't be undone.",
      confirmLabel: "Delete for everyone",
      tone: "destructive",
    });
    if (!confirmed) return;
    await deleteConfirmed(tile.sample, "group");
  }

  async function removeTask(task: Task) {
    // A copy of a live series asks which, as the event editors do (#5119):
    // this copy, or stop the repeat (its open copy goes only if untouched).
    if (task.series && !task.series.ended) {
      const picked = await confirm({
        title: TASK_SERIES_SCOPE_COPY.deleteTitle,
        description: TASK_SERIES_SCOPE_COPY.deleteMessage,
        confirmLabel: TASK_SERIES_SCOPE_COPY.allUpcoming,
        alternativeLabel: TASK_SERIES_SCOPE_COPY.thisTask,
        tone: "destructive",
      });
      if (!picked) return;
      await deleteConfirmed(task, picked.alternative ? "instance" : "series");
      return;
    }
    const confirmed = await confirm({
      title: `Delete "${task.title}"?`,
      description: "This can't be undone.",
      confirmLabel: "Delete task",
      tone: "destructive",
    });
    if (!confirmed) return;
    await deleteConfirmed(task, "instance");
  }

  /** The delete itself, after the member said yes: what Try again repeats. */
  async function deleteConfirmed(task: Task, scope: TaskEditScope) {
    try {
      await deleteTask.mutateAsync(
        scope === "instance" ? task.id : { id: task.id, scope },
      );
      toast(
        scope === "group"
          ? {
              title: "Task deleted",
              description: `${task.title} was removed for everyone.`,
            }
          : scope === "series"
            ? {
                title: "Stopped repeating",
                description: `${task.title} won't repeat. Tasks already done or overdue stay.`,
              }
            : {
                title: "Task deleted",
                description: `${task.title} was removed.`,
              },
      );
    } catch (error) {
      toastFailure({
        title: "Couldn't delete task",
        error,
        fallback: "Try again in a moment.",
        retry: () => deleteConfirmed(task, scope),
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
   * viewer, so an uncached `/v1/users/me` hides Confirm on *every* row. Online,
   * a failed read says so above the board (#1346); offline that read may be
   * paused rather than errored (`anyReadUncached`
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

  // The status lanes say which status a task is in; any other grouping puts
  // the status on the tile.
  const statusGrouped = view === "all" && groupBy === "status";
  // A board nothing matches draws no lanes, so the add row heads the page.
  const addRowInTodo =
    statusGrouped &&
    (statusFilter === null || statusFilter === "TODO") &&
    !(filtering && shown === 0);
  const addRow =
    canManage || !permissionsKnown ? (
      <Can permission="tasks:manage">
        <AddTaskRow
          members={members}
          gate={gate}
          pending={createTask.isPending}
          onCreate={createFromDraft}
        />
      </Can>
    ) : null;
  // Two reads the board renders without, so neither blanks it (#1346, #1209).
  // Each says so instead, above a board that keeps working, and only when it
  // has nothing cached (a failed refetch over a good answer changes nothing
  // on screen). Your account decides which tasks are yours, so without it
  // every viewer loses Start, Mark done and the like on their own tasks, and
  // an officer loses Confirm on every task. The roster is said only to a
  // viewer who may read it (`GET /v1/members` needs `members:view`), since a
  // refusal is not a failure a retry can clear; while permissions are unknown
  // the board says it rather than stay silent.
  const viewerUnreadable = currentUser.isError && myUserId === "";
  const rosterUnreadable =
    (!permissionsKnown ||
      can("members:view", permissionsPayload?.permissions)) &&
    membersQuery.isError &&
    membersQuery.data === undefined;

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
      <StaleReadNotice
        stale={viewerUnreadable || rosterUnreadable}
        message={[
          viewerUnreadable
            ? canManage
              ? "We couldn't confirm your account, so Confirm and the buttons on your own tasks are hidden until it loads."
              : "We couldn't confirm your account, so the buttons on your tasks are hidden until it loads."
            : null,
          rosterUnreadable
            ? "We couldn't load member names, so tasks show a short id in place of who they're assigned to."
            : null,
        ]
          .filter(Boolean)
          .join(" ")}
        onRetry={() => {
          if (viewerUnreadable) void currentUser.refetch();
          if (rosterUnreadable) void membersQuery.refetch();
        }}
      />

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
            One toolbar row over the groups. An officer's view switch leads
            it (Asana's My tasks beside a project, Linear's My issues beside
            the team's); the chapter's board adds its grouping and filter
            chips (Linear's Display and Filter, as the Directory's chips
            draw them). The List / Grid switch keeps the trailing edge,
            where Linear's and Asana's List / Board sit.
          */}
          <div className="flex flex-wrap items-center gap-2">
            {canManage ? (
              <SegmentedChoice
                label="Whose tasks"
                options={VIEW_OPTIONS}
                value={view}
                onChange={setOfficerView}
              />
            ) : null}
            {view === "all" && canManage ? (
              <>
                <SegmentedChoice
                  label="Group tasks"
                  options={GROUP_BY_OPTIONS}
                  value={groupBy}
                  onChange={setGroupBy}
                />
                <FilterChip
                  label="Assignee"
                  anyLabel="Anyone"
                  options={filterOptions.assignee}
                  value={assigneeFilter}
                  onChange={setAssigneeFilter}
                />
                <FilterChip
                  label="Status"
                  anyLabel="Any status"
                  options={filterOptions.status}
                  value={statusFilter}
                  onChange={(next) =>
                    setStatusFilter(next as StatusFilter | null)
                  }
                />
                <FilterChip
                  label="Due"
                  anyLabel="Any time"
                  options={filterOptions.due}
                  value={dueFilter}
                  onChange={(next) => setDueFilter(next as DueFilter | null)}
                />
                {filtering ? (
                  <Button
                    type="button"
                    size="toolbar"
                    variant="ghost"
                    onClick={clearFilters}
                  >
                    Clear filters
                  </Button>
                ) : null}
              </>
            ) : null}
            <div className="ml-auto">
              <ListLayoutToggle screen="tasks" />
            </div>
          </div>
          {/*
            Rule 2: the first action sits where the first item goes. On the
            status board that is the head of To do, as it always was; any
            other grouping has no To do, so the add row heads the page.
          */}
          {canManage && !addRowInTodo ? addRow : null}
          {filtering && shown === 0 ? (
            <InlineNote>No tasks match these filters.</InlineNote>
          ) : view === "mine" && canManage && myUserId === "" ? (
            // The failed read says so above the board; until it answers,
            // say what's coming rather than draw an empty page.
            viewerUnreadable ? null : (
              <InlineNote>Loading your tasks…</InlineNote>
            )
          ) : (
            <div
              className={
                isGrid
                  ? "grid gap-x-6 gap-y-8 @2xl:grid-cols-2 @4xl:grid-cols-4"
                  : "space-y-8"
              }
            >
              {groups.map((group) => {
                const labelId = `tasks-column-${group.id}`;
                const headsTodo = group.id === "todo" && addRowInTodo;
                return (
                  <section
                    key={group.id}
                    aria-labelledby={labelId}
                    className="min-w-0 space-y-3"
                  >
                    <SectionLabel
                      id={labelId}
                      count={
                        group.tasks.length + (group.groupTiles?.length ?? 0)
                      }
                    >
                      {group.label}
                    </SectionLabel>
                    {headsTodo ? addRow : null}
                    {group.groupTiles && group.groupTiles.length > 0 ? (
                      <ul className={taskListClassName(layout)}>
                        {group.groupTiles.map((tile) => (
                          <GroupTaskCard
                            key={tile.id}
                            layout={layout}
                            tile={tile}
                            nameOf={(id) =>
                              id === myUserId
                                ? "You"
                                : (membersByUserId.get(id) ??
                                  memberFallbackLabel(id))
                            }
                            gate={gate}
                            onDelete={() => void removeGroup(tile)}
                          />
                        ))}
                      </ul>
                    ) : null}
                    {group.tasks.length === 0 ? (
                      (group.groupTiles?.length ?? 0) > 0 ||
                      (headsTodo && canManage) ? null : (
                        <p className="text-sm text-muted-foreground">
                          {group.empty}
                        </p>
                      )
                    ) : (
                      <ul className={taskListClassName(layout)}>
                        {group.tasks.map((task) => (
                          <TaskCard
                            key={task.id}
                            layout={layout}
                            task={task}
                            // Not under a heading that already says it.
                            showStatus={
                              !statusGrouped && group.id !== "waiting"
                            }
                            assigneeName={
                              membersByUserId.get(task.assignee_id) ??
                              memberFallbackLabel(task.assignee_id)
                            }
                            myUserId={myUserId}
                            canManage={canManage}
                            gate={gate}
                            lifecycleWritePending={lifecycleWritePending}
                            onChangeStatus={(next, proof) =>
                              changeStatus(task, next, proof)
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
          )}
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
                onChangeStatus={(next) => changeStatus(task, next)}
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
  showStatus = false,
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
  /**
   * Say where the task stands on the tile: in My tasks and By person no
   * status lane says it. To do needs no word (its Start says it), and
   * Overdue is already the due line in the warning hue.
   */
  showStatus?: boolean;
  assigneeName: string;
  myUserId: string;
  /** Holds `tasks:manage`: may check off and edit anyone's subtasks. */
  canManage: boolean;
  gate: SubscriptionGate;
  lifecycleWritePending: boolean;
  /** Resolves `false` when the write was refused (and already reported). */
  onChangeStatus: (
    next: TaskStatus,
    proof?: CompletionProof,
  ) => Promise<boolean>;
  onConfirm: () => void;
  onReject: () => void;
  onDelete: () => void;
}) {
  // Fails closed. `myUserId` is "" while `useCurrentUser` is in flight or
  // errored, which would otherwise make `isMine` false for every row and put
  // Confirm back on your own task — the flip-and-revert this gate exists to
  // stop. Treat an unknown viewer as "might be me".
  //
  // The cost: the board has no early return for `currentUser`, so if
  // `GET /v1/users/me` fails terminally, Confirm stays hidden on *every* row.
  // Hiding a control the server would accept is the safer failure than
  // offering one it will refuse, and the board says why above the columns
  // (#1346), so nobody reads it as a revoked grant.
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
  const autoSignedOff = taskSignedOffAutomatically(task);
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
        {/* No `·` before it either: its ↻ separates it, as the checklist's
            icon does (#5119). */}
        {task.series && !task.series.ended ? (
          <TaskRepeatLine task={task} next />
        ) : null}
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
          <Badge className="ml-1">{formatPointsChip(task.point_reward)}</Badge>
        ) : null}
        {status !== "COMPLETED" ? <ProofBadge kind={task.proof_kind} /> : null}
        {showStatus && !sentBack && status === "IN_PROGRESS" ? (
          <Badge variant="outline" className="ml-1">
            {TASK_STATUS_LABELS.IN_PROGRESS}
          </Badge>
        ) : null}
        {showStatus && status === "COMPLETED" && !task.points_awarded ? (
          <Badge variant="outline" className="ml-1">
            {TASK_STATUS_LABELS.COMPLETED}
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
          onClick={() => void onChangeStatus("IN_PROGRESS")}
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
        signedOffAutomatically: autoSignedOff,
      }) ? (
        <Button
          size="toolbar"
          variant="ghost"
          {...gate.controlProps(lifecycleWritePending)}
          onClick={() => void onChangeStatus("IN_PROGRESS")}
        >
          {TASK_ACTION_LABELS.reopen}
        </Button>
      ) : null}
      <Can permission="tasks:manage">
        {status === "COMPLETED" && (!task.points_awarded || autoSignedOff) ? (
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

/**
 * A task for everyone on the chapter's board (#4295 step 3): one tile for
 * its copies still to finish, with how many are done, the way Google
 * Classroom lists an assignment with its turned-in count. "Who's left"
 * opens the members still to finish and where each stands. Edit and Delete
 * act on everyone's copy; a member's own copy is changed from By person.
 */
function GroupTaskCard({
  layout,
  tile,
  nameOf,
  gate,
  onDelete,
}: {
  layout: ListLayout;
  tile: GroupTileData;
  nameOf: (userId: string) => string;
  gate: SubscriptionGate;
  onDelete: () => void;
}) {
  const [whoOpen, setWhoOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const task = tile.sample;
  const isRow = layout === "list";
  const due = taskDueClause(task);
  const whoId = `group-task-${tile.id}-who`;
  const progress = tile.total > 0 ? tile.done / tile.total : 0;

  if (editing) {
    return (
      <li
        aria-label={`Editing ${task.title} for everyone`}
        className={cn(
          "rounded-[14px] border border-ring/60 p-3",
          isRow && "my-2",
        )}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !event.defaultPrevented) {
            event.stopPropagation();
            setEditing(false);
          }
        }}
      >
        <TaskEditForm
          group
          task={task}
          assigneeName={TASK_AUDIENCE_COPY.everyone}
          gate={gate}
          onClose={() => setEditing(false)}
        />
      </li>
    );
  }

  return (
    <li
      aria-label={`${task.title}, for everyone`}
      className={isRow ? "py-3" : "rounded-[14px] border border-border p-3"}
    >
      <div className={cn(isRow && "flex items-start gap-3 @xl:gap-4")}>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">{task.title}</p>
          {task.description ? (
            <p
              className={cn(
                "mt-1 text-caption text-muted-foreground",
                isRow ? "line-clamp-1" : "line-clamp-2",
              )}
            >
              {task.description}
            </p>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-caption text-muted-foreground">
            {due ? (
              <>
                <span
                  className={due.overdue ? "text-destructive-text" : undefined}
                >
                  {due.text}
                </span>
                <span aria-hidden="true">·</span>
              </>
            ) : null}
            <span className="inline-flex items-center gap-1">
              <Users className="h-3 w-3" aria-hidden="true" />
              {TASK_AUDIENCE_COPY.everyone}
            </span>
            {task.point_reward ? (
              <Badge className="ml-1">
                {formatPointsChip(task.point_reward)}
              </Badge>
            ) : null}
            <ProofBadge kind={task.proof_kind} />
          </div>
          <div className="mt-3 grid gap-1.5">
            <div className="flex items-center justify-between gap-2 text-caption">
              <span className="font-medium text-foreground">
                {TASK_AUDIENCE_COPY.progress(tile.done, tile.total)}
              </span>
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-expanded={whoOpen}
                aria-controls={whoId}
                onClick={() => setWhoOpen((open) => !open)}
              >
                {`Who's left (${tile.open.length})`}
                <ChevronDown
                  className={cn(
                    "h-3.5 w-3.5 transition-transform",
                    whoOpen && "rotate-180",
                  )}
                  aria-hidden="true"
                />
              </button>
            </div>
            <div
              className="h-1.5 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-label={`${task.title}: ${TASK_AUDIENCE_COPY.progress(tile.done, tile.total)}`}
              aria-valuemin={0}
              aria-valuemax={tile.total}
              aria-valuenow={tile.done}
            >
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
          </div>
          {whoOpen ? (
            <ul id={whoId} className="mt-2 grid gap-1 text-caption">
              {tile.open.map((copy) => (
                <li
                  key={copy.id}
                  className="flex items-center justify-between gap-2"
                >
                  <span className="min-w-0 truncate text-foreground">
                    {nameOf(copy.assignee_id)}
                  </span>
                  <span
                    className={cn(
                      "shrink-0",
                      copy.status === "OVERDUE"
                        ? "text-destructive-text"
                        : "text-muted-foreground",
                    )}
                  >
                    {isSentBack(copy)
                      ? TASK_NEEDS_CHANGES_LABEL
                      : TASK_STATUS_LABELS[copy.status]}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <Can permission="tasks:manage">
          <div
            className={cn(
              "flex items-center gap-2",
              isRow ? "justify-end" : "mt-3 justify-end",
            )}
          >
            <Button
              size="toolbar"
              variant="ghost"
              className="w-9 px-0 pointer-coarse:w-11 pointer-coarse:px-0"
              aria-label={`Edit ${task.title} for everyone`}
              {...gate.controlProps()}
              onClick={() => setEditing(true)}
            >
              <Pencil className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button
              size="toolbar"
              variant="ghost"
              className="w-9 px-0 pointer-coarse:w-11 pointer-coarse:px-0"
              aria-label={`Delete ${task.title} for everyone`}
              {...gate.controlProps()}
              onClick={onDelete}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </Can>
      </div>
    </li>
  );
}

/** What Mark done needs, on a tile: nothing for a task that asks for none. */
function ProofBadge({ kind }: { kind?: string | null }) {
  if (kind !== "photo" && kind !== "link") return null;
  return (
    <Badge variant="outline" className="ml-1 gap-1">
      {kind === "photo" ? (
        <Camera className="h-3 w-3" aria-hidden="true" />
      ) : (
        <Link2 className="h-3 w-3" aria-hidden="true" />
      )}
      {kind === "photo" ? "Photo required" : "Link required"}
    </Badge>
  );
}
