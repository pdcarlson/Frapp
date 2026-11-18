"use client";

import { describeLoadFailure } from "@repo/hooks/error-copy";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Camera,
  CheckCircle2,
  Link2,
  ChevronDown,
  Pencil,
  Plus,
  SlidersHorizontal,
  Trash2,
  Undo2,
  Users,
} from "lucide-react";
import {
  isFirstAiReadInFlight,
  useAiSuggestions,
  useConfirmTask,
  useCreateOpenTask,
  useCreateTask,
  useCurrentUser,
  useDeleteTask,
  useEvents,
  useMemberDisplayNames,
  useMembers,
  useMyPermissions,
  useNow,
  useOpenTasks,
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
import type { TaskEditScope, TaskStatus } from "@repo/hooks";
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
  taskGroupLabel,
  taskNeedsSignOff,
  taskSignedOffAutomatically,
} from "@repo/validation";
import { ToastAction } from "@/components/ui/toast";
import { FOCUS_RING } from "@/components/ui/focus";
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
import { asArray, cn } from "@/lib/utils";
import { TASKS_GROUP_PARAM, TASKS_TASK_PARAM } from "@/lib/tasks/task-links";
import { taskDueClause } from "./task-due";
import { TaskSubtaskList, TaskSubtasksToggle } from "./task-subtasks";
import { TaskRepeatLine } from "./task-repeat";
import {
  MarkDoneControl,
  SendBackDialog,
  TaskProof,
  type CompletionProof,
} from "./task-photo";
import { AddTaskRow, type TaskCreate } from "./add-task-row";
import type { BoardTask, GroupTileData } from "./board-task";
import {
  GroupTaskRow,
  TASK_ROWS_CLASS,
  TaskRow,
  lowerFirst,
  type RowPerson,
} from "./task-row";
import { TaskPanel, type TaskPanelTarget } from "./task-panel";
import { OpenTaskPanel, UpForGrabs } from "./up-for-grabs";
import { SuggestionsStrip } from "./suggestions-strip";
import { TasksPageSkeleton } from "@/components/tasks/tasks-skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FilterChip, type FilterOption } from "@/components/shared/filter-chip";
import { SegmentedChoice } from "@/components/ui/segmented";
import { useListLayout, type ListLayout } from "@/lib/list-layout";

type Task = BoardTask;

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

const LAYOUT_OPTIONS = [
  { value: "list", label: "List" },
  { value: "grid", label: "Grid" },
] as const satisfies readonly { value: ListLayout; label: string }[];

/** The status groups' order in List: late first (by group id). */
const LIST_STATUS_ORDER = ["overdue", "todo", "in_progress", "completed"];

/** Rows a long List group shows before "N more". */
const LIST_PREVIEW = 8;

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

/**
 * Reads `?group=<group id>` or `?task=<task id>` (`lib/tasks/task-links.ts`,
 * #5538) and opens that group, or that task (its group when it is a copy of
 * one), in the task panel once the board's read holds it. The param then
 * leaves the address so a refresh doesn't reopen it, as the Events and
 * Documents links do. The read in hand can be a cached one that predates
 * the task, so a miss is read again once before the board says it's gone
 * (the task was deleted, or the viewer can't read it). Its own component
 * because `useSearchParams` needs a Suspense boundary of its own.
 */
function LinkedTaskParam({
  tasks,
  refetch,
  onOpen,
  onMissing,
}: {
  tasks: Task[];
  refetch: () => Promise<unknown>;
  onOpen: (target: { kind: "task" | "group"; id: string }) => void;
  onMissing: () => void;
}) {
  const searchParams = useSearchParams();
  const groupId = searchParams?.get(TASKS_GROUP_PARAM) ?? null;
  const taskId = searchParams?.get(TASKS_TASK_PARAM) ?? null;
  const key = groupId ? `group:${groupId}` : taskId ? `task:${taskId}` : null;
  const handled = useRef<string | null>(null);
  const rereading = useRef<string | null>(null);
  const [reread, setReread] = useState<string | null>(null);
  // The board hands new callbacks each render; the link is acted on once.
  const latest = useRef({ refetch, onOpen, onMissing });
  useEffect(() => {
    latest.current = { refetch, onOpen, onMissing };
  });
  useEffect(() => {
    if (!key) {
      handled.current = null;
      return;
    }
    if (handled.current === key) return;
    let target: { kind: "task" | "group"; id: string } | null = null;
    if (groupId) {
      if (tasks.some((task) => task.group_id === groupId))
        target = { kind: "group", id: groupId };
    } else if (taskId) {
      const task = tasks.find((candidate) => candidate.id === taskId);
      if (task)
        target = task.group_id
          ? { kind: "group", id: task.group_id }
          : { kind: "task", id: task.id };
    }
    if (!target && reread !== key) {
      if (rereading.current !== key) {
        rereading.current = key;
        void latest.current
          .refetch()
          .catch(() => undefined)
          .finally(() => setReread(key));
      }
      return;
    }
    handled.current = key;
    if (target) latest.current.onOpen(target);
    else latest.current.onMissing();
    // Next keeps `useSearchParams` in step with the History API, so this
    // clears the parameter without a navigation.
    window.history.replaceState(
      window.history.state,
      "",
      window.location.pathname,
    );
  }, [key, groupId, taskId, tasks, reread]);
  return null;
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
  const createOpenTask = useCreateOpenTask();
  const { avatarTintFor } = useMemberDisplayNames();
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
  const avatarsByUserId = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const m of members) {
      if (m.user_id) map.set(String(m.user_id), m.avatar_url ?? null);
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
  // What the panel shows: a task, a group task, or a posting up for grabs.
  const [opened, setOpened] = useState<{
    kind: "task" | "group" | "posting";
    id: string;
  } | null>(null);
  // New task bumps it, which opens the add line's More (Paul, 2026-11-18).
  const [expandSignal, setExpandSignal] = useState(0);
  // List groups opened past their first rows.
  const [expandedGroups, setExpandedGroups] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  // Shared with Up for grabs' own read, so a posting opens from the cache.
  const openTasksQuery = useOpenTasks();
  // Grid is the board of status columns, the page's only view until #4175
  // and still its default; List is the same groups as rows, top to bottom.
  const [layout, setLayout] = useListLayout("tasks");
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
    if (!isGrid && view === "all" && groupBy === "status") {
      // A list reads top to bottom, so what's late leads it, then what's
      // to do, as Linear's and Todoist's lists put overdue first.
      drawn.sort(
        (a, b) =>
          LIST_STATUS_ORDER.indexOf(a.id) - LIST_STATUS_ORDER.indexOf(b.id),
      );
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
    isGrid,
  ]);

  // Resolves whether it was created, so the add line knows to clear. A
  // task up for grabs goes to `POST /v1/open-tasks` (2026-11-18).
  async function createFrom(create: TaskCreate): Promise<boolean> {
    try {
      if (create.endpoint === "/v1/open-tasks") {
        await createOpenTask.mutateAsync(create.body);
        toast({
          title: `Posted to ${TASK_AUDIENCE_COPY.upForGrabs}`,
          description: create.body.title,
        });
      } else {
        await createTask.mutateAsync(create.body);
        toast({
          title: "Task created",
          description: `${create.body.title} is now assigned.`,
        });
      }
      return true;
    } catch (error) {
      toastFailure({
        title: "Couldn't create task",
        error,
        fallback: "Retry in a moment or check who it's for.",
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
  // the status on the row.
  const statusGrouped = view === "all" && groupBy === "status";
  const addRow =
    canManage || !permissionsKnown ? (
      <Can permission="tasks:manage">
        <AddTaskRow
          gate={gate}
          pending={createTask.isPending || createOpenTask.isPending}
          onCreate={createFrom}
          expandSignal={expandSignal}
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

  const nameOf = (id: string) =>
    id === myUserId
      ? "You"
      : (membersByUserId.get(id) ?? memberFallbackLabel(id));
  const personOf = (id: string): RowPerson => ({
    name: membersByUserId.get(id) ?? memberFallbackLabel(id),
    avatarUrl: avatarsByUserId.get(id) ?? null,
    tint: avatarTintFor(id),
  });

  // The task, group or posting open in the panel, read from the live lists
  // so it shows every change; gone (deleted, claimed) closes the panel.
  let panelTarget: TaskPanelTarget | null = null;
  if (opened?.kind === "task") {
    const task = tasks.find((row) => row.id === opened.id);
    panelTarget = task ? { kind: "task", task } : null;
  } else if (opened?.kind === "group") {
    const copies = tasks.filter((row) => row.group_id === opened.id);
    const open = copies.filter((row) => isOpenStatus(row.status));
    open.sort(compareTasksByDue);
    const sample = open[0] ?? copies[0];
    if (sample) {
      panelTarget = {
        kind: "group",
        copies,
        tile: {
          id: opened.id,
          sample,
          open,
          total: sample.group?.total ?? copies.length,
          done: sample.group?.done ?? copies.length - open.length,
        },
      };
    }
  }

  const rowProps = (task: Task, inWaiting: boolean) => {
    const isMine = myUserId !== "" && task.assignee_id === myUserId;
    return {
      task,
      person: personOf(task.assignee_id),
      isMine,
      showStatus: !statusGrouped && !inWaiting,
      // Never on your own (#1056), and never while the viewer is unknown.
      canConfirm:
        canManage && myUserId !== "" && !isMine && taskNeedsSignOff(task),
      gate,
      lifecycleWritePending,
      selected: opened?.kind === "task" && opened.id === task.id,
      onOpen: () => setOpened({ kind: "task", id: task.id }),
      onChangeStatus: (next: TaskStatus, proof?: CompletionProof) =>
        changeStatus(task, next, proof),
      onConfirm: () => void confirmCompletion(task),
    };
  };

  const cardProps = (task: Task) => ({
    task,
    assigneeName:
      membersByUserId.get(task.assignee_id) ??
      memberFallbackLabel(task.assignee_id),
    myUserId,
    canManage,
    gate,
    lifecycleWritePending,
    onOpen: () => setOpened({ kind: "task", id: task.id }),
    onChangeStatus: (next: TaskStatus, proof?: CompletionProof) =>
      changeStatus(task, next, proof),
    onConfirm: () => void confirmCompletion(task),
    onReject: () => void rejectCompletion(task),
    onDelete: () => void removeTask(task),
  });

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

      {/* One line until asked for (Paul, 2026-11-18). */}
      {canManage ? <SuggestionsStrip /> : null}

      {plateIsClear ? (
        /*
          Done is one line (rule 7): a member's board with nothing on it is
          four empty columns, so the line takes its place, and says what's
          next rather than only what isn't there. What's up for grabs still
          leads it.
        */
        <>
          <UpForGrabs
            canManage={canManage}
            gate={gate}
            selectedId={opened?.kind === "posting" ? opened.id : null}
            onOpen={(posting) => setOpened({ kind: "posting", id: posting.id })}
          />
          <InlineNote>
            {nextUpLine(eventsOn ? eventsQuery.data : undefined, nowTick)}
          </InlineNote>
        </>
      ) : permissionsLoading && tasks.length === 0 ? null : (
        /*
          Flush, not carded. A group is a section on the page surface, named
          by its label and count. In List (the default since 2026-11-18) each
          task is a 40px row that opens the task's panel; in Grid the tiles
          keep a hairline frame, because a kanban tile is a block with its
          own controls.
        */
        <>
          {/*
            At most two toolbar rows over the groups, even in the Tasks
            column beside chat (~480px). The first: an officer's view switch
            (Asana's My tasks beside a project, Linear's My issues beside the
            team's), then View and New task at the trailing edge, where
            Linear's and Asana's sit. View is one menu holding the grouping and
            List / Grid, as Linear's Display menu holds both. The second: the
            chapter's board's filter chips (Linear's Filter, as the
            Directory's chips draw them).
          */}
          <div className="grid gap-2">
            <div className="flex items-center gap-2">
              {canManage ? (
                <SegmentedChoice
                  label="Whose tasks"
                  options={VIEW_OPTIONS}
                  value={view}
                  onChange={setOfficerView}
                />
              ) : null}
              <div className="ml-auto flex shrink-0 items-center gap-2">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      size="toolbar"
                      variant="secondary"
                      className="gap-1.5"
                    >
                      <SlidersHorizontal
                        className="h-4 w-4"
                        aria-hidden="true"
                      />
                      View
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" collisionPadding={12}>
                    {view === "all" && canManage ? (
                      <>
                        <DropdownMenuLabel>Group tasks</DropdownMenuLabel>
                        <DropdownMenuRadioGroup
                          value={groupBy}
                          onValueChange={(next) =>
                            setGroupBy(next as TasksGroupBy)
                          }
                        >
                          {GROUP_BY_OPTIONS.map((option) => (
                            <DropdownMenuRadioItem
                              key={option.value}
                              value={option.value}
                            >
                              {option.label}
                            </DropdownMenuRadioItem>
                          ))}
                        </DropdownMenuRadioGroup>
                        <DropdownMenuSeparator />
                      </>
                    ) : null}
                    <DropdownMenuLabel>Layout</DropdownMenuLabel>
                    <DropdownMenuRadioGroup
                      value={layout}
                      onValueChange={(next) => setLayout(next as ListLayout)}
                    >
                      {LAYOUT_OPTIONS.map((option) => (
                        <DropdownMenuRadioItem
                          key={option.value}
                          value={option.value}
                        >
                          {option.label}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
                {canManage ? (
                  <Button
                    type="button"
                    size="toolbar"
                    className="gap-1.5"
                    {...gate.controlProps()}
                    onClick={() => setExpandSignal((n) => n + 1)}
                  >
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    New task
                  </Button>
                ) : null}
              </div>
            </div>
            {view === "all" && canManage ? (
              <div className="flex flex-wrap items-center gap-2">
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
              </div>
            ) : null}
          </div>
          {/*
            Rule 2: the first action sits where the first item goes, so the
            add line heads the list, as Todoist's quick add does.
          */}
          {addRow}
          <UpForGrabs
            canManage={canManage}
            gate={gate}
            selectedId={opened?.kind === "posting" ? opened.id : null}
            onOpen={(posting) => setOpened({ kind: "posting", id: posting.id })}
          />
          {filtering && shown === 0 ? (
            <InlineNote>No tasks match these filters.</InlineNote>
          ) : view === "mine" && canManage && myUserId === "" ? (
            // The failed read says so above the board; until it answers,
            // say what's coming rather than draw an empty page.
            viewerUnreadable ? null : (
              <InlineNote>Loading your tasks…</InlineNote>
            )
          ) : view === "mine" &&
            canManage &&
            shown === 0 &&
            confirmed.length === 0 ? (
            <InlineNote>
              Nothing on your plate. Tasks given to you show up here.
            </InlineNote>
          ) : (
            <div
              className={
                isGrid
                  ? "grid gap-x-6 gap-y-8 @2xl:grid-cols-2 @4xl:grid-cols-4"
                  : "space-y-6"
              }
            >
              {groups.map((group) => {
                const labelId = `tasks-column-${group.id}`;
                const tiles = group.groupTiles ?? [];
                const count = group.tasks.length + tiles.length;
                // In List, a group with nothing in it draws nothing: four
                // empty headings would push the work down the page.
                if (!isGrid && count === 0) return null;
                const long =
                  !isGrid &&
                  !expandedGroups.has(group.id) &&
                  group.tasks.length > LIST_PREVIEW + 2;
                const rows = long
                  ? group.tasks.slice(0, LIST_PREVIEW)
                  : group.tasks;
                return (
                  <section
                    key={group.id}
                    aria-labelledby={labelId}
                    className={cn(
                      "min-w-0",
                      isGrid ? "space-y-3" : "space-y-1",
                    )}
                  >
                    <SectionLabel id={labelId} count={count}>
                      {group.label}
                    </SectionLabel>
                    {tiles.length > 0 ? (
                      <ul className={taskListClassName(layout)}>
                        {tiles.map((tile) =>
                          isGrid ? (
                            <GroupTaskCard
                              key={tile.id}
                              tile={tile}
                              nameOf={nameOf}
                              gate={gate}
                              onOpen={() =>
                                setOpened({ kind: "group", id: tile.id })
                              }
                              onDelete={() => void removeGroup(tile)}
                            />
                          ) : (
                            <GroupTaskRow
                              key={tile.id}
                              tile={tile}
                              selected={
                                opened?.kind === "group" &&
                                opened.id === tile.id
                              }
                              onOpen={() =>
                                setOpened({ kind: "group", id: tile.id })
                              }
                            />
                          ),
                        )}
                      </ul>
                    ) : null}
                    {group.tasks.length === 0 ? (
                      tiles.length > 0 ? null : (
                        <p className="text-sm text-muted-foreground">
                          {group.empty}
                        </p>
                      )
                    ) : (
                      <ul className={taskListClassName(layout)}>
                        {rows.map((task) =>
                          isGrid ? (
                            <TaskCard
                              key={task.id}
                              {...cardProps(task)}
                              // Not under a heading that already says it.
                              showStatus={
                                !statusGrouped && group.id !== "waiting"
                              }
                            />
                          ) : (
                            <TaskRow
                              key={task.id}
                              {...rowProps(task, group.id === "waiting")}
                            />
                          ),
                        )}
                      </ul>
                    )}
                    {long ? (
                      <Button
                        type="button"
                        size="toolbar"
                        variant="ghost"
                        onClick={() =>
                          setExpandedGroups((previous) =>
                            new Set(previous).add(group.id),
                          )
                        }
                      >
                        {`${group.tasks.length - LIST_PREVIEW} more`}
                      </Button>
                    ) : null}
                  </section>
                );
              })}
            </div>
          )}
        </>
      )}

      {/*
        Confirmed tasks, under the groups rather than in them: they are
        finished, so they are the quietest thing on the page, and Waiting on
        an officer stays the officer's queue. Newest first, the latest few by
        default, every one a click away.
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
            ).map((task) =>
              isGrid ? (
                <TaskCard key={task.id} {...cardProps(task)} />
              ) : (
                <TaskRow key={task.id} {...rowProps(task, false)} />
              ),
            )}
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
      <Suspense fallback={null}>
        <LinkedTaskParam
          tasks={tasks}
          refetch={tasksQuery.refetch}
          onOpen={setOpened}
          onMissing={() =>
            toast({
              title: "Couldn't find that task",
              description: "It may have been deleted.",
            })
          }
        />
      </Suspense>
      <TaskPanel
        target={panelTarget}
        onClose={() => setOpened(null)}
        personOf={personOf}
        myUserId={myUserId}
        canManage={canManage}
        gate={gate}
        lifecycleWritePending={lifecycleWritePending}
        onChangeStatus={changeStatus}
        onConfirm={(task) => void confirmCompletion(task)}
        onReject={(task) => rejectCompletion(task)}
        onDelete={(task) => void removeTask(task)}
        onDeleteGroup={(tile) => void removeGroup(tile)}
      />
      {canManage ? (
        <OpenTaskPanel
          posting={
            opened?.kind === "posting"
              ? ((openTasksQuery.data ?? []).find(
                  (posting) => posting.id === opened.id,
                ) ?? null)
              : null
          }
          gate={gate}
          onClose={() => setOpened(null)}
        />
      ) : null}
    </div>
  );
}

/**
 * A task group's list: in Grid a stack of framed tiles, in List flush rows
 * split by a hairline, as the Documents and Directory lists are.
 */
function taskListClassName(layout: ListLayout): string {
  return layout === "grid" ? "space-y-2" : TASK_ROWS_CLASS;
}

/**
 * One task as a tile in a Grid column (#4175). The List draws `TaskRow`
 * instead, which opens the task panel for its controls (2026-11-18).
 */
function TaskCard({
  task,
  showStatus = false,
  assigneeName,
  myUserId,
  canManage,
  gate,
  lifecycleWritePending,
  onOpen,
  onChangeStatus,
  onConfirm,
  onReject,
  onDelete,
}: {
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
  /** Open the task in its panel, where it is edited (2026-11-18). */
  onOpen: () => void;
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
  // A confirmed task's points were paid on it as it stood, so it has no
  // Edit; it still opens, to read.
  const editable = canManage && !task.points_awarded;
  // No points and no proof: Done as marked, nothing to confirm (#4635).
  const needsSignOff = taskNeedsSignOff(task);
  const autoSignedOff = taskSignedOffAutomatically(task);
  const sentBack = isSentBack(task);

  const summary = (
    <div className="min-w-0 flex-1">
      <p className="text-sm font-semibold text-foreground">
        <button
          type="button"
          onClick={onOpen}
          className={cn("rounded text-left hover:underline", FOCUS_RING)}
        >
          {task.title}
        </button>
      </p>
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
            onClick={onOpen}
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
    <li className="rounded-[14px] border border-border p-3">
      {/*
        The checklist opens under the meta line that holds its toggle, and
        the controls end the tile.
      */}
      {summary}
      {subtaskList}
      {controls}
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
 * A group task on the Grid board (#4295 step 3): one tile for its copies
 * still to finish, with how many are done, the way Google Classroom lists an
 * assignment with its turned-in count. "Who's left" opens the members still
 * to finish and where each stands. Edit opens the group in the task panel,
 * which saves to every copy; Delete removes every copy.
 */
function GroupTaskCard({
  tile,
  nameOf,
  gate,
  onOpen,
  onDelete,
}: {
  tile: GroupTileData;
  nameOf: (userId: string) => string;
  gate: SubscriptionGate;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const [whoOpen, setWhoOpen] = useState(false);
  const task = tile.sample;
  const due = taskDueClause(task);
  const whoId = `group-task-${tile.id}-who`;
  const progress = tile.total > 0 ? tile.done / tile.total : 0;
  const label = task.group
    ? taskGroupLabel({
        audience: task.group.audience ?? "everyone",
        target_name: task.group.target_name,
        total: tile.total,
      })
    : TASK_AUDIENCE_COPY.everyone;

  return (
    <li
      aria-label={`${task.title}, for ${lowerFirst(label)}`}
      className="rounded-[14px] border border-border p-3"
    >
      <div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">
            <button
              type="button"
              onClick={onOpen}
              className={cn("rounded text-left hover:underline", FOCUS_RING)}
            >
              {task.title}
            </button>
          </p>
          {task.description ? (
            <p className="mt-1 line-clamp-2 text-caption text-muted-foreground">
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
            <span className="inline-flex min-w-0 items-center gap-1">
              <Users className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span className="truncate">{label}</span>
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
              className="h-1.5 overflow-hidden rounded-full bg-border"
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
          <div className="mt-3 flex items-center justify-end gap-2">
            <Button
              size="toolbar"
              variant="ghost"
              className="w-9 px-0 pointer-coarse:w-11 pointer-coarse:px-0"
              aria-label={`Edit ${task.title} for everyone`}
              {...gate.controlProps()}
              onClick={onOpen}
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
