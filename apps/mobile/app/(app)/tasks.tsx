import {
  describeLoadFailure,
  errorCopy,
  MemberFacingError,
} from "@repo/hooks/error-copy";
import { statusOf } from "@repo/api-sdk";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import {
  AccessibilityInfo,
  AppState,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import {
  useActiveChapterId,
  useChapterRoster,
  useCurrentChapter,
  useCurrentUser,
  useEvents,
  useLeaderboard,
  useMyPoints,
  usePermissionList,
  useTasks,
  useUpdateTaskStatus,
  useViewerUserId,
  type TaskStatus,
} from "@repo/hooks";
import { nextUpLine } from "@repo/formatting";
import { memberLabel } from "@repo/hooks/display-names";
import { canAll, isModuleEnabled } from "@repo/validation";
import { PLUS_MENU_PERMISSIONS } from "@repo/chat-core/plus-menu";
import { SignetTokens } from "@repo/theme/signet";
import { useRefetchAll } from "@/components/pull-to-refresh";
import { SuggestedTasksEntry } from "@/components/tasks/suggested-tasks-entry";
import { ScreenShell } from "@/components/screen-shell";
import { BACK_TO_ACTIVITY } from "@/components/back-row";
import {
  SectionHeader,
  SectionHeaderSkeleton,
} from "@/components/list-section";
import {
  ErrorState,
  NoChapterState,
  SkeletonRegion,
} from "@/components/state-block";
import { InlineNote } from "@/components/inline-note";
import {
  TaskRow,
  TaskRowSkeleton,
  TaskTile,
} from "@/components/tasks/task-row";
import { GridLine, toGridChunks } from "@/components/grid-line";
import { ListLayoutToggle } from "@/components/list-layout-toggle";
import { useListLayout } from "@/lib/list-layout";
import { TaskDetailSheet } from "@/components/tasks/task-detail-sheet";
import { NewTaskSheet } from "@/components/tasks/new-task-sheet";
import { taskCreatedLine } from "@/lib/tasks/create-task";
import { SheetBoundary } from "@/components/quick-actions/quick-actions-host";
import type { TaskEditTarget } from "@/lib/tasks/create-task";
import { UNDO_WINDOW_MS, UndoBar } from "@/components/tasks/undo-bar";
import { PointsSummaryCard } from "@/components/tasks/points-summary-card";
import {
  rowIsSentBack,
  selectTaskRows,
  toTaskRow,
  type TaskRowModel,
} from "@/lib/tasks/board";
import { selectHouseRank, selectPointsSummary } from "@/lib/tasks/points-card";
import { checkboxSequence } from "@/lib/tasks/transitions";
import {
  taskProofRefusal,
  taskStatusGateRefusal,
} from "@/lib/tasks/status-refusal";
import { markDoneAsks } from "@/lib/tasks/task-photos";
import {
  MARK_DONE_ALREADY_DONE,
  MarkDoneSheet,
  type CompletionProof,
} from "@/components/tasks/mark-done-sheet";
import { successHaptic } from "@/lib/haptics";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * s08 — the task board, with the points balance and house rank folded in
 * (`canvas-screens.dc.html`, `id="s08"`).
 *
 * A pushed screen since 2026-11-12 (#4610): it was the third tab until
 * Activity and Calendar took the bar, since a member's tasks are Activity's
 * first rows and dots on the calendar. It opens from Activity's Task board
 * control, its points row, a task on the calendar and Up next. Pushed, it has
 * no tab bar and so no +, so it draws New task itself for an officer who can
 * assign (`createAction`), as Service hours draws Log hours.
 *
 * This screen is the landing site for the routes S2 deleted: `points.tsx` and
 * `points-details.tsx` are gone, and `spec/ui/mobile/screens.md` records their
 * balance and rank as re-landing here as stat cards.
 *
 * Composition only. Every rule lives in `lib/tasks/` where it is unit-tested,
 * and every optimistic write lives in `packages/hooks` (#560) — the acceptance
 * criteria of #995 name both placements explicitly.
 *
 * ## Only the checkbox changes a task, and it can be taken back
 *
 * A tap on a row opens the task's detail sheet; only the checkbox completes it
 * (owner audit 2026-11-06, P6.1). Completing floats "Marked done · Undo" over
 * the tab bar for a few seconds, and the box itself unchecks until an officer
 * confirms: the API lets the assignee move their own unconfirmed completion
 * back to `IN_PROGRESS` (`spec/behavior/tasks.md` § Assignee Actions).
 *
 * ## Proof first, where the task asks for it
 *
 * On a task that asks for a photo or a link, or one an officer sent back,
 * the box and the sheet's Mark done open Mark done's sheet instead
 * (`components/tasks/mark-done-sheet.tsx`, #4635), which takes the proof or
 * a reply and sends it with the `COMPLETED` write. A direct Mark done the
 * server refuses for want of proof (the task changed since it was read)
 * opens the same sheet with the reason in it.
 *
 * ## The checkbox is two writes, not one
 *
 * The server's assignee transition table has no `TODO → COMPLETED` edge, so
 * completing a fresh task walks `IN_PROGRESS` first. `nextTapSequence` owns that
 * ladder; this screen only awaits it in order, because both writes are
 * compare-and-set against the stored status and firing them in parallel loses
 * the race by construction.
 *
 * Each write is individually optimistic and individually rolls back inside
 * `useUpdateTaskStatus`. The honest consequence: a `TODO` row's box fills after
 * about one round trip rather than instantly, and if the second write fails
 * after the first succeeds the task genuinely sits at `IN_PROGRESS` — which the
 * row then draws as started. That is a true rendering of server state.
 *
 * ## Why the board filters by assignee
 *
 * `GET /v1/tasks` serves a `tasks:manage` holder the chapter's whole task set.
 * s08 is drawn as a personal board, so `selectTaskRows` keeps only the viewer's
 * rows — see its header. An officer's review queue is a different surface with a
 * different shape, and is not this slice.
 */
const TAKE_BACK_FAILED =
  "Couldn't mark that task not done. An officer may have confirmed it already.";
const MARK_DONE_FAILED = "Couldn't mark that task done. Try again.";

export default function TasksScreen() {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);

  const chapterId = useActiveChapterId();
  // List (the rows) or Grid (task cards two to a line), per phone (#4175).
  const layout = useListLayout("tasks");
  const viewerUserId = useViewerUserId();
  // The query behind `useViewerUserId`, for its error state: that helper returns
  // `null` for *failed* as well as *pending*, and the board needs to tell them
  // apart or a dead `/v1/users/me` pins it on a skeleton with no way out.
  const viewerQuery = useCurrentUser();
  const tasksQuery = useTasks();
  const pointsQuery = useMyPoints("semester");
  const leaderboardQuery = useLeaderboard("semester");
  // The board is drawn only with a chapter id (see `renderBoard`), so the pull
  // leaves it out without one. `useTasks`' own gate (`useChapterScope`) opens
  // for a claim-less sole member too, whose board this screen doesn't show.
  const refresh = useRefetchAll([
    viewerQuery,
    chapterId ? tasksQuery : null,
    pointsQuery,
    leaderboardQuery,
  ]);
  const updateStatus = useUpdateTaskStatus();

  // `canAll` from @repo/validation, not a bare `includes` — an owner's grant is the
  // wildcard `*`, so a membership test would hide the control from exactly the
  // people who assign work. The C2 pattern, verbatim.
  const permissions = usePermissionList();
  // The hint points at the quick actions' New task, so it reads that action's
  // grant (`PLUS_MENU_PERMISSIONS.task`: `tasks:manage` under `members:view`).
  const canManageTasks = canAll(PLUS_MENU_PERMISSIONS.task, permissions);

  // One clock for the whole render, so the two sections cannot straddle a tick
  // and disagree about what "today" means — but re-read whenever the member
  // comes back: to the screen (a navigation focus, here) or to the app on this
  // tab (the AppState listener below, which `useFocusEffect` never sees). A tab
  // is never unmounted and the JS context survives days of backgrounding, so a
  // mount-only clock would keep bucketing by the day the app was opened, and
  // a task due today would sit under the wrong day.
  const [now, setNow] = useState(() => new Date());
  useFocusEffect(
    useCallback(() => {
      setNow(new Date());
      return undefined;
    }, []),
  );
  const board = useMemo(
    () => selectTaskRows(tasksQuery.data, viewerUserId, now),
    [tasksQuery.data, viewerUserId, now],
  );
  // "Next up" names the chapter's next event, so the events read runs only
  // when it can be shown: the board has loaded with nothing on it, and the
  // chapter has Events on. The chapter must be read first, because an unread
  // `enabled_modules` counts as on and would fire a read Events-off refuses.
  const chapterQuery = useCurrentChapter();
  const enabledModules = (
    chapterQuery.data as
      { enabled_modules?: Record<string, boolean> } | undefined
  )?.enabled_modules;
  const eventsOn =
    chapterQuery.isSuccess && isModuleEnabled(enabledModules, "events");
  const canCreate =
    chapterId !== null &&
    canManageTasks &&
    isModuleEnabled(enabledModules, "tasks");
  const plateIsClear =
    tasksQuery.isSuccess && viewerUserId !== null && board.total === 0;
  const eventsQuery = useEvents({ enabled: plateIsClear && eventsOn });

  const summary = useMemo(
    () => selectPointsSummary(pointsQuery.data),
    [pointsQuery.data],
  );
  const rank = useMemo(
    () => selectHouseRank(leaderboardQuery.data, viewerUserId),
    [leaderboardQuery.data, viewerUserId],
  );

  const [pendingId, setPendingId] = useState<string | null>(null);
  /**
   * The member copy for a gate refusal on a status toggle, or `null` (#2710).
   *
   * `PATCH /v1/tasks/:id/status` is refused permanently, until an officer
   * acts, by two gates: the subscription gate (the controller has no
   * `@FreeTier`, so every brand-new `incomplete` chapter hits it) and the
   * module gate (`@RequireModule('tasks')` on the whole controller). The
   * hook's optimistic write reverts either way, so without this the box
   * filled and emptied with no word of why, and every retap did it again.
   * While it is set the board says why and offers no toggle. The copy is the
   * latch, so the sentence and the withdrawn toggles can't disagree.
   */
  const [refusal, setRefusal] = useState<string | null>(null);
  // Cleared when the member comes back, because a tab is never unmounted: an
  // officer may have sorted the gate out since, and returning is a deliberate
  // second look rather than a retry in place. Back to the screen is a
  // navigation focus; back to the app on this same tab is an AppState change,
  // which `useFocusEffect` never sees. Without the second, a member who
  // reopens the app after the officer's fix finds the board still refused,
  // and nothing on it says to leave the tab and return.
  useFocusEffect(
    useCallback(() => {
      setRefusal(null);
      return undefined;
    }, []),
  );
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      if (next !== "active") return;
      setRefusal(null);
      // The clock too (see `now` above): a member who leaves the app on this
      // tab overnight comes back to today's board and today's chips.
      setNow(new Date());
    });
    return () => subscription.remove();
  }, []);
  /**
   * Ids with a sequence in flight.
   *
   * A ref rather than the `pendingId` state because two taps in one frame both
   * observe the pre-render state value: the second would start its own sequence
   * against an already-advanced row, collect a guaranteed 400 from the server's
   * compare-and-set, and — worse — clear the busy flag while the first sequence
   * was still mid-write.
   */
  const inFlight = useRef<Set<string>>(new Set());

  /**
   * The task the undo bar offers to take back, while its window runs. Cleared
   * by its own timer, by Undo, or by the box unchecking the same task.
   */
  const [undo, setUndo] = useState<{
    id: string;
    message: string;
    key: number;
  } | null>(null);
  useEffect(() => {
    if (!undo) return undefined;
    const timer = setTimeout(() => setUndo(null), UNDO_WINDOW_MS);
    return () => clearTimeout(timer);
  }, [undo]);

  /**
   * A one-off line for a take-back that didn't land: the bar has gone by
   * then, and without it the row just stays done with no word of why. Not a
   * latch like `refusal`: the next tap, or coming back, clears it.
   */
  const [notice, setNotice] = useState<string | null>(null);
  useFocusEffect(
    useCallback(() => {
      setNotice(null);
      return undefined;
    }, []),
  );

  /**
   * Sends one sequence for one task, in order, guarded against a double tap.
   * Resolves to what happened: a gate refusal has already said why.
   */
  const run = useCallback(
    async (
      id: string,
      sequence: readonly TaskStatus[],
      /** Proof and a reply, sent with the `COMPLETED` write (#4635). */
      proof?: CompletionProof,
    ): Promise<{
      outcome: "ok" | "gate" | "failed" | "skipped";
      error?: unknown;
    }> => {
      if (sequence.length === 0) return { outcome: "skipped" };
      if (inFlight.current.has(id)) return { outcome: "skipped" };

      inFlight.current.add(id);
      setPendingId(id);
      try {
        for (const status of sequence) {
          await updateStatus.mutateAsync({
            id,
            body: status === "COMPLETED" ? { status, ...proof } : { status },
          });
        }
        return { outcome: "ok" };
      } catch (error) {
        // The hook has already reverted its own write and invalidated, so the
        // row redraws at whatever the server actually holds. A gate refusal
        // also says why and withdraws the toggles; anything else, a permission
        // 403 or an officer's confirm landing first included, stays the quiet
        // revert it always was.
        const gate = taskStatusGateRefusal(error);
        if (gate) setRefusal(gate);
        return { outcome: gate ? "gate" : "failed", error };
      } finally {
        inFlight.current.delete(id);
        setPendingId(null);
      }
    },
    [updateStatus],
  );

  /**
   * Mark done's sheet (#4635), for the task it is open on: a task that asks
   * for a photo or a link, or was sent back, takes it there before it is
   * marked done. `problem` is the line it opens with when a direct Mark done
   * was refused for want of proof (the task changed since it was read).
   */
  const [marking, setMarking] = useState<{
    id: string;
    problem: string | null;
  } | null>(null);

  /** Felt and offered once a completion lands: the haptic and the undo. */
  const completed = useCallback((id: string) => {
    successHaptic();
    setUndo((open) => ({
      id,
      message: "Marked done",
      // A new key per completion, so a second one inside the window is
      // announced again even though the words are the same.
      key: (open?.key ?? 0) + 1,
    }));
  }, []);

  const toggle = useCallback(
    async (row: TaskRowModel) => {
      const sequence = checkboxSequence(row);
      const completes = sequence[sequence.length - 1] === "COMPLETED";
      setNotice(null);
      // Unchecking is its own undo: the bar for this task has nothing left to
      // offer. Cleared before the write so it never sits over the change.
      if (!completes) setUndo((open) => (open?.id === row.id ? null : open));
      // A task that asks for proof, or was sent back, takes it in Mark
      // done's sheet first (#4635); any other is marked done at once.
      if (
        completes &&
        markDoneAsks({ proofKind: row.proofKind, sentBack: rowIsSentBack(row) })
      ) {
        setMarking({ id: row.id, problem: null });
        return;
      }
      const { outcome, error } = await run(row.id, sequence);
      // The confirming action (`spec/ui/mobile/README.md` § Native-feel
      // rules), felt once the server holds the task done. Only a sequence
      // that completes the task earns it, and offers the undo.
      if (outcome === "ok" && completes) completed(row.id);
      // The task asks for proof the board didn't know of (an officer changed
      // it since it was read): its sheet asks for it rather than the box
      // reverting with no word.
      const proofProblem = taskProofRefusal(error);
      if (proofProblem) setMarking({ id: row.id, problem: proofProblem });
      if (outcome === "failed" && !completes) setNotice(TAKE_BACK_FAILED);
      // A 400 is the server refusing this Mark done for a reason it states,
      // such as the task changing under the member (#4635's compare-and-set:
      // "This task changed…"), so it is said rather than the box reverting
      // in silence. Any other failure keeps the quiet revert and the retap.
      else if (
        outcome === "failed" &&
        !proofProblem &&
        statusOf(error) === 400
      ) {
        setNotice(
          errorCopy(error, MARK_DONE_FAILED, { serverWritesForMembers: true }),
        );
      }
    },
    [run, completed],
  );

  /** Mark done from its sheet, proof attached. Rejects for the sheet to say why. */
  const completeWithProof = useCallback(
    async (row: TaskRowModel, proof: CompletionProof) => {
      const sequence = checkboxSequence(row);
      // Already done (on another device, say): nothing left to send, and the
      // sheet says so rather than closing as if it had sent the proof.
      if (sequence[sequence.length - 1] !== "COMPLETED") {
        throw new MemberFacingError(MARK_DONE_ALREADY_DONE);
      }
      const { outcome, error } = await run(row.id, sequence, proof);
      if (outcome === "ok") {
        completed(row.id);
        return;
      }
      if (outcome !== "skipped") throw error;
    },
    [run, completed],
  );

  const takeBack = useCallback(
    async (id: string) => {
      setUndo(null);
      setNotice(null);
      // Most often refused because an officer confirmed it inside the
      // window: the bar has gone, so say so rather than leave it done.
      if ((await run(id, ["IN_PROGRESS"])).outcome === "failed") {
        setNotice(TAKE_BACK_FAILED);
      }
    },
    [run],
  );

  // The detail sheet. It holds the id, not the row, so it redraws with the
  // board as a write lands.
  const sheetRef = useRef<BottomSheetModal>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const findRow = useCallback(
    (id: string | null): TaskRowModel | null => {
      if (id === null) return null;
      const onBoard = [...board.dueThisWeek, ...board.later].find(
        (row) => row.id === id,
      );
      if (onBoard) return onBoard;
      // Opened from the Events calendar (#4144), which also shows a task the
      // board has let go of (finished more than a week ago): read it off the
      // same query rather than open an empty sheet.
      const raw = Array.isArray(tasksQuery.data)
        ? (tasksQuery.data as unknown[]).find(
            (row) =>
              !!row &&
              typeof row === "object" &&
              (row as { id?: unknown }).id === id,
          )
        : undefined;
      return raw ? toTaskRow(raw as Record<string, unknown>) : null;
    },
    [board, tasksQuery.data],
  );
  const openRow = useMemo(() => findRow(openId), [findRow, openId]);
  // Mark done's sheet reads its task off the board too, so a refetch that
  // finds the task now asks for a photo redraws the sheet asking for one.
  const markingRow = useMemo(
    () => findRow(marking?.id ?? null),
    [findRow, marking],
  );

  // `/tasks?task=<id>`: the Events calendar's way in. Opens that task's
  // sheet once its row is readable, then clears the param so coming back to
  // the tab doesn't open it again.
  const { task: linkedTaskId } = useLocalSearchParams<{ task?: string }>();
  const router = useRouter();
  const linked =
    typeof linkedTaskId === "string" && linkedTaskId !== ""
      ? linkedTaskId
      : null;
  const [openedLink, setOpenedLink] = useState<string | null>(null);
  if (linked !== null && tasksQuery.isSuccess && openedLink !== linked) {
    setOpenedLink(linked);
    setOpenId(linked);
  } else if (linked === null && openedLink !== null) {
    setOpenedLink(null);
  }
  useEffect(() => {
    if (openedLink === null) return;
    sheetRef.current?.present();
    router.setParams({ task: undefined });
  }, [openedLink, router]);
  const rosterQuery = useChapterRoster();
  const createdBy = openRow?.createdBy ?? null;
  const assignedBy = useMemo(() => {
    if (!createdBy) return null;
    if (createdBy === viewerUserId) return "You";
    const match = (rosterQuery.data ?? []).find(
      (member) => member.user_id === createdBy,
    );
    // The shared fallback, so a creator with no name reads as on web.
    return memberLabel(match?.display_name, createdBy);
  }, [createdBy, rosterQuery.data, viewerUserId]);

  // New task (#4610): the board is pushed, so the tab bar's + isn't under it
  // and the board draws its own, as Service hours draws Log hours. Mounted on
  // first use and kept while the board is open, so a closed sheet keeps its
  // draft until the member leaves; like Service hours' sheet, it is not the
  // quick actions' one. Offered only while the chapter has Tasks on, as the
  // quick action is (`availableQuickActions`).
  const createRef = useRef<BottomSheetModal>(null);
  const [createMounted, setCreateMounted] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  useEffect(() => {
    if (createMounted) createRef.current?.present();
  }, [createMounted]);
  const openCreate = useCallback(() => {
    setCreated(null);
    if (createMounted) createRef.current?.present();
    else setCreateMounted(true);
  }, [createMounted]);
  useFocusEffect(
    useCallback(() => {
      setCreated(null);
      return undefined;
    }, []),
  );
  // An officer's edit (#4296): the New task sheet, opened on the task. One
  // sheet per task edited, mounted for the edit and gone once it closes, so
  // its fields always start from the task as it stands.
  const editRef = useRef<BottomSheetModal>(null);
  const [editing, setEditing] = useState<TaskEditTarget | null>(null);
  useEffect(() => {
    if (editing) editRef.current?.present();
  }, [editing]);
  const startEdit =
    canManageTasks &&
    openRow &&
    !openRow.pointsAwarded &&
    openRow.assigneeId &&
    openRow.dueDay
      ? () => {
          sheetRef.current?.dismiss();
          setEditing({
            id: openRow.id,
            title: openRow.title,
            assigneeId: openRow.assigneeId!,
            dueDay: openRow.dueDay!,
            dueAt: openRow.dueAt,
            pointReward: openRow.pointReward,
            storedStatus: openRow.storedStatus,
            referencePhotos: openRow.photos.filter(
              (photo) => photo.kind === "reference",
            ),
            proofKind: openRow.proofKind,
          });
        }
      : undefined;

  const canToggle = useCallback(
    (row: TaskRowModel) =>
      pendingId !== row.id &&
      refusal === null &&
      checkboxSequence(row).length > 0,
    [pendingId, refusal],
  );

  const renderRows = useCallback(
    (rows: TaskRowModel[]) => {
      // Both layouts take the same two targets: the box (dropped, not
      // disabled-in-place, while the sequence runs, since the task is
      // mid-ladder and a second tap would race the compare-and-set) and the
      // rest, which opens the detail sheet, where an officer's Edit sits.
      const props = (row: TaskRowModel) => ({
        row,
        now,
        isPending: pendingId === row.id,
        onToggle: canToggle(row) ? () => void toggle(row) : undefined,
        onOpen: () => {
          setOpenId(row.id);
          sheetRef.current?.present();
        },
      });
      if (layout === "grid") {
        return (
          <View style={styles.grid}>
            {toGridChunks(rows).map((line) => (
              <GridLine key={line[0]!.id} filled={line.length}>
                {line.map((row) => (
                  <TaskTile key={row.id} {...props(row)} />
                ))}
              </GridLine>
            ))}
          </View>
        );
      }
      return (
        <View>
          {rows.map((row, index) => (
            <TaskRow key={row.id} {...props(row)} isFirst={index === 0} />
          ))}
        </View>
      );
    },
    [now, pendingId, canToggle, toggle, layout, styles.grid],
  );

  function renderBoard() {
    // With no chapter id, "pick a chapter" is the honest answer: the points
    // and leaderboard reads beside the board wait on a chapter id, and for a
    // member with no membership `useTasks` sends nothing (#4094) and sits
    // pending, which would otherwise draw a skeleton that never ends.
    if (!chapterId) return <NoChapterState noun="your tasks" />;

    // Checked before the pending gate below, because `useViewerUserId` reports a
    // failed `/v1/users/me` as `null` too. Without this branch a 500 there
    // leaves the board shimmering forever with no retry, a screen dead until a
    // force-quit. A pull refetches it too (#3385), but nothing on screen says
    // so, which is why `ErrorState` keeps its button (`state-block.tsx`).
    if (viewerQuery.isError && viewerQuery.data === undefined) {
      return (
        <ErrorState
          title="Couldn't load your account"
          body={describeLoadFailure(viewerQuery.error)}
          onRetry={() => void viewerQuery.refetch()}
          isRetrying={viewerQuery.isFetching}
        />
      );
    }

    // `viewerUserId === null` here is "/v1/users/me has not answered yet", not
    // "no tasks". Treating it as empty flashes "Nothing on your plate" on every cold
    // start, a beat before the real rows land.
    if (tasksQuery.isPending || viewerUserId === null) {
      // A section caption over task-shaped rows, so the real board lands in
      // place. The caption is a bar: which section comes first (DUE THIS WEEK
      // or LATER) depends on the tasks.
      return (
        <SkeletonRegion label="Loading chapter tasks" style={styles.skeleton}>
          <SectionHeaderSkeleton width="30%" />
          <View>
            {Array.from({ length: 3 }, (_, index) => (
              <TaskRowSkeleton key={index} index={index} />
            ))}
          </View>
        </SkeletonRegion>
      );
    }

    if (tasksQuery.isError && tasksQuery.data === undefined) {
      return (
        <ErrorState
          title="Couldn't load your tasks"
          body={describeLoadFailure(tasksQuery.error)}
          onRetry={() => void tasksQuery.refetch()}
          isRetrying={tasksQuery.isFetching}
        />
      );
    }

    if (board.total === 0) {
      return (
        // One line under the points card, not a card of its own (`writing.md`
        // § 4, rule 7): the plate is clear, then what comes next, so the line
        // says more than what isn't there. Web's Tasks board writes the same
        // line (`nextUpLine`). An officer also hears where assigning lives,
        // this screen's own + (New task, #4610).
        <InlineNote>
          {nextUpLine(eventsOn ? eventsQuery.data : undefined, now.getTime())}
          {canManageTasks ? " Tap + to assign a task." : null}
        </InlineNote>
      );
    }

    return (
      <>
        {board.dueThisWeek.length > 0 ? (
          <>
            <SectionHeader>DUE THIS WEEK</SectionHeader>
            {renderRows(board.dueThisWeek)}
          </>
        ) : null}

        {board.later.length > 0 ? (
          <>
            <SectionHeader>LATER</SectionHeader>
            {renderRows(board.later)}
          </>
        ) : null}
      </>
    );
  }

  return (
    <View style={styles.frame}>
      <ScreenShell
        back={BACK_TO_ACTIVITY}
        title="Tasks"
        refresh={refresh}
        createAction={
          canCreate ? { label: "New task", onPress: openCreate } : undefined
        }
        headerAction={
          chapterId ? <ListLayoutToggle screen="tasks" /> : undefined
        }
      >
        <PointsSummaryCard summary={summary} rank={rank} />

        {created ? <InlineNote>{created}</InlineNote> : null}

        {refusal ? <Text style={styles.refusal}>{refusal}</Text> : null}
        {notice && !refusal ? (
          <Text style={styles.refusal}>{notice}</Text>
        ) : null}

        {renderBoard()}

        <SuggestedTasksEntry />
      </ScreenShell>

      {undo ? (
        <UndoBar
          key={undo.key}
          message={undo.message}
          onUndo={() => void takeBack(undo.id)}
          aboveCreate={canCreate}
        />
      ) : null}

      <TaskDetailSheet
        ref={sheetRef}
        row={openRow}
        assignedBy={assignedBy}
        refusal={refusal}
        onToggle={
          openRow && canToggle(openRow)
            ? () => {
                sheetRef.current?.dismiss();
                void toggle(openRow);
              }
            : undefined
        }
        onEdit={startEdit}
        onDismiss={() => setOpenId(null)}
      />

      {createMounted ? (
        // A new sheet per chapter: a kept draft belongs to the chapter it was
        // started in, as the quick actions' sheets are keyed. A sheet that
        // throws is dropped, not the board with it.
        <SheetBoundary
          key={`create-${chapterId ?? "none"}`}
          onError={() => setCreateMounted(false)}
        >
          <NewTaskSheet
            ref={createRef}
            now={now}
            onCreated={(assigneeName, wasSelf) => {
              // Someone else's task is on no board here, so say where it went.
              const text = taskCreatedLine(assigneeName, wasSelf);
              setCreated(text);
              AccessibilityInfo.announceForAccessibility(text);
            }}
          />
        </SheetBoundary>
      ) : null}

      {marking && markingRow ? (
        <MarkDoneSheet
          key={marking.id}
          task={{
            id: markingRow.id,
            title: markingRow.title,
            proofKind: markingRow.proofKind,
            sentBack: rowIsSentBack(markingRow),
            sentBackReason: markingRow.sentBackReason,
            done: markingRow.isDone,
          }}
          initialProblem={marking.problem}
          onComplete={(proof) => completeWithProof(markingRow, proof)}
          onClosed={() => setMarking(null)}
        />
      ) : null}

      {editing ? (
        <NewTaskSheet
          key={editing.id}
          ref={editRef}
          now={now}
          editing={editing}
          onClosed={() => setEditing(null)}
        />
      ) : null}
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    frame: {
      flex: 1,
    },
    // A Grid section's lines, as Documents' (`document-tiles.tsx`).
    grid: {
      gap: tokens.spacing.sm,
    },
    // `ScreenShell`'s gap, between the caption and its rows.
    skeleton: {
      gap: tokens.spacing.md,
    },
    refusal: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructive,
    },
  });
}
