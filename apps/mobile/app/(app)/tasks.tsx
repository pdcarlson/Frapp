import { describeLoadFailure, errorCopy } from "@repo/hooks/error-copy";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { AccessibilityInfo, Alert, StyleSheet, Text, View } from "react-native";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import {
  useActiveChapterId,
  useAssignOpenTask,
  useChapterRoster,
  useClaimOpenTask,
  useDeleteOpenTask,
  useOpenTasks,
  useReleaseTask,
  useCurrentChapter,
  useCurrentUser,
  useEvents,
  useLeaderboard,
  useMyPoints,
  usePermissionList,
  useTasks,
  useViewerUserId,
  MY_TASKS_GROUPS,
  MY_TASKS_GROUP_LABELS,
  type OpenTask,
} from "@repo/hooks";
import { nextUpLine } from "@repo/formatting";
import { memberLabel } from "@repo/hooks/display-names";
import { TASK_AUDIENCE_COPY, canAll, isModuleEnabled } from "@repo/validation";
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
import { OpenTaskRow } from "@/components/tasks/open-task-row";
import {
  OpenTaskAssignPicker,
  OpenTaskSheet,
} from "@/components/tasks/open-task-sheet";
import {
  claimLost,
  claimedLine,
  claimedTaskId,
  RELEASE_FAILED,
  RELEASED_LINE,
  RELEASED_PARAM,
  openTaskWho,
  selectOpenTasks,
} from "@/lib/tasks/open-tasks";
import { NewTaskSheet } from "@/components/tasks/new-task-sheet";
import { taskCreatedLine } from "@/lib/tasks/create-task";
import { SheetBoundary } from "@/components/quick-actions/quick-actions-host";
import { UndoBar } from "@/components/tasks/undo-bar";
import { PointsSummaryCard } from "@/components/tasks/points-summary-card";
import {
  selectTaskRows,
  toTaskRow,
  type TaskRowModel,
} from "@/lib/tasks/board";
import { selectHouseRank, selectPointsSummary } from "@/lib/tasks/points-card";
import { MarkDoneHost, useTaskToggle } from "@/lib/tasks/use-task-toggle";
import { useTaskMenu } from "@/lib/tasks/use-task-menu";
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
 * A tap on a row pushes the task's own screen (`task-details.tsx`, #5492,
 * where the detail sheet used to rise); only the checkbox completes it here
 * (owner audit 2026-11-06, P6.1). Completing floats "Marked done · Undo" over
 * the board for a few seconds, and the box itself unchecks until an officer
 * confirms: the API lets the assignee move their own unconfirmed completion
 * back to `IN_PROGRESS` (`spec/behavior/tasks.md` § Assignee Actions). The
 * box's writes, proof sheet and refusals are `useTaskToggle`
 * (`lib/tasks/use-task-toggle.tsx`), which the task screen's Mark done shares.
 *
 * A long press on a row or card opens the task's menu (`useTaskMenu`, #5492):
 * Mark done, Edit, Reassign, Remove people, Duplicate and Delete, each to the
 * viewer the API lets use it. Its Mark done is the box's, Undo and all.
 *
 * ## Why the board filters by assignee
 *
 * `GET /v1/tasks` serves a `tasks:manage` holder the chapter's whole task set.
 * s08 is drawn as a personal board, so `selectTaskRows` keeps only the viewer's
 * rows — see its header. An officer's review queue is a different surface with a
 * different shape, and is not this slice.
 */
const CLAIM_FAILED = "Couldn't claim that task. Try again.";
const POSTING_FAILED = "That didn't go through. Try again.";

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
  // Up for grabs (spec/behavior/tasks.md § Up for grabs): what this member may claim, and
  // for an officer who manages tasks, every open posting.
  const openTasksQuery = useOpenTasks();
  const pointsQuery = useMyPoints("semester");
  const leaderboardQuery = useLeaderboard("semester");
  // The board is drawn only with a chapter id (see `renderBoard`), so the pull
  // leaves it out without one. `useTasks`' own gate (`useChapterScope`) opens
  // for a claim-less sole member too, whose board this screen doesn't show.
  const refresh = useRefetchAll([
    viewerQuery,
    chapterId ? tasksQuery : null,
    chapterId ? openTasksQuery : null,
    pointsQuery,
    leaderboardQuery,
  ]);

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
  // screen (`onActive` on `useTaskToggle`'s AppState listener below, which
  // `useFocusEffect` never sees). The JS context survives days of
  // backgrounding, so a mount-only clock would keep bucketing by the day the
  // app was opened, and a task due today would sit under the wrong day.
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
  const enabledModules = chapterQuery.data?.enabled_modules;
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

  // The task a row opens and the one Mark done's sheet is open on, read off
  // the board, or off the same query for a task the board has let go of
  // (finished more than a week ago).
  const findRow = useCallback(
    (id: string | null): TaskRowModel | null => {
      if (id === null) return null;
      const onBoard = MY_TASKS_GROUPS.flatMap(
        (group) => board.groups[group],
      ).find((row) => row.id === id);
      if (onBoard) return onBoard;
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
  // The box's writes, shared with the task screen's Mark done. Coming back
  // to the app on this screen also re-reads the clock (see `now` above): a
  // member who leaves the app here overnight comes back to today's board.
  const toggles = useTaskToggle(findRow, {
    viewerId: viewerUserId,
    onActive: () => setNow(new Date()),
  });
  const { pendingId, refusal, notice, undo, canToggle, toggle, takeBack } =
    toggles;

  // A tap on a row pushes the task's own screen (#5492).
  const router = useRouter();
  const openTask = useCallback(
    (id: string) => router.push({ pathname: "/task-details", params: { id } }),
    [router],
  );

  // `/tasks?task=<id>`: a task push's way in (`lib/notifications/targets.ts`).
  // Pushes that task's screen once the board's read holds it, then clears the
  // param so coming back to the board doesn't open it again. Only a task the
  // viewer can read opens: a push (Overdue also reaches the assigner) can
  // name one their read doesn't hold, such as an assigner who has since lost
  // tasks:manage, or a task deleted since. They land on the board instead.
  const { task: linkedTaskId } = useLocalSearchParams<{ task?: string }>();
  const linked =
    typeof linkedTaskId === "string" && linkedTaskId !== ""
      ? linkedTaskId
      : null;
  const [openedLink, setOpenedLink] = useState<{
    id: string;
    readable: boolean;
  } | null>(null);
  if (linked !== null && tasksQuery.isSuccess && openedLink?.id !== linked) {
    setOpenedLink({
      id: linked,
      readable:
        Array.isArray(tasksQuery.data) &&
        (tasksQuery.data as unknown[]).some(
          (row) =>
            !!row &&
            typeof row === "object" &&
            (row as { id?: unknown }).id === linked,
        ),
    });
  } else if (linked === null && openedLink !== null) {
    setOpenedLink(null);
  }
  useEffect(() => {
    if (openedLink === null) return;
    router.setParams({ task: undefined });
    if (openedLink.readable) openTask(openedLink.id);
  }, [openedLink, router, openTask]);

  // New task (#4610): the board is pushed, so the tab bar's + isn't under it
  // and the board draws its own, as Service hours draws Log hours. Mounted on
  // first use and kept while the board is open, so a closed sheet keeps its
  // draft until the member leaves; like Service hours' sheet, it is not the
  // quick actions' one. Offered only while the chapter has Tasks on, as the
  // quick action is (`availableQuickActions`).
  const createRef = useRef<BottomSheetModal>(null);
  const [createMounted, setCreateMounted] = useState(false);
  // The line under the points card. `keep` holds it through the focus that
  // brought the member here, for one set as they arrived (Give it back from
  // the task's screen), which that focus would otherwise clear.
  const [createdLine, setCreatedLine] = useState<{
    text: string;
    keep: boolean;
  } | null>(null);
  const created = createdLine?.text ?? null;
  const setCreated = useCallback(
    (text: string | null) =>
      setCreatedLine(text === null ? null : { text, keep: false }),
    [],
  );
  useEffect(() => {
    if (createMounted) createRef.current?.present();
  }, [createMounted]);
  // A row's long-press menu (#5492): its Mark done is the box's, and a
  // Duplicate says where it went in the line New task's create uses.
  const taskMenu = useTaskMenu({ toggles, onCreated: setCreated });
  const { menuFor } = taskMenu;
  const openCreate = useCallback(() => {
    setCreated(null);
    if (createMounted) createRef.current?.present();
    else setCreateMounted(true);
  }, [createMounted, setCreated]);
  useFocusEffect(
    useCallback(() => {
      setCreatedLine((line) => (line?.keep ? { ...line, keep: false } : null));
      return undefined;
    }, []),
  );

  // `/tasks?released=1`: the task's screen gave a task back to Up for grabs
  // and came here, where the posting is back; the board says so in its line,
  // as after its own toast's Give it back, then clears the param.
  const { [RELEASED_PARAM]: released } = useLocalSearchParams<{
    [RELEASED_PARAM]?: string;
  }>();
  const [releaseSeen, setReleaseSeen] = useState(false);
  if (released === "1" && !releaseSeen) {
    setReleaseSeen(true);
    setCreatedLine({ text: RELEASED_LINE, keep: true });
  } else if (released !== "1" && releaseSeen) {
    setReleaseSeen(false);
  }
  useEffect(() => {
    if (!releaseSeen) return undefined;
    router.setParams({ [RELEASED_PARAM]: undefined });
    // The arrival's focus may come just before the param or just after it;
    // once this turn is over the line is an ordinary one, which the next
    // focus clears.
    const settle = setTimeout(() =>
      setCreatedLine((line) => (line?.keep ? { ...line, keep: false } : line)),
    );
    return () => clearTimeout(settle);
  }, [releaseSeen, router]);

  const rosterQuery = useChapterRoster();
  const { setNotice, offerRelease, clearUndo } = toggles;
  // Up for grabs (spec/behavior/tasks.md § Up for grabs). A claim is optimistic in the
  // hook: the row leaves on the tap, the task lands in its day once the board
  // reads again, and a toast offers Give it back. A claim another member won
  // (a 409) says so, and the row stays gone while the list reads again.
  const claimOpen = useClaimOpenTask();
  const releaseTask = useReleaseTask();
  const assignOpen = useAssignOpenTask();
  const deleteOpen = useDeleteOpenTask();
  // A lost claim hides its posting only until the list reads again: the
  // fresh read leaves out a claimed posting itself, and shows it again if
  // its taker gives it back. So each hide is keyed to the read it was made on.
  const openTasksReadAt = openTasksQuery.dataUpdatedAt;
  const [lostClaims, setLostClaims] = useState<{
    readAt: number;
    ids: ReadonlySet<string>;
  }>(() => ({ readAt: 0, ids: new Set() }));
  const openTasks = useMemo(
    () =>
      selectOpenTasks(
        openTasksQuery.data,
        lostClaims.readAt === openTasksReadAt ? lostClaims.ids : new Set(),
      ),
    [openTasksQuery.data, lostClaims, openTasksReadAt],
  );
  const nameOf = useCallback(
    (userId: string) =>
      memberLabel(
        (rosterQuery.data ?? []).find((member) => member.user_id === userId)
          ?.display_name,
        userId,
      ),
    [rosterQuery.data],
  );

  const claim = useCallback(
    (posting: OpenTask) => {
      setNotice(null);
      setCreated(null);
      claimOpen.mutate(posting.id, {
        onSuccess: (data) => {
          successHaptic();
          const taskId = claimedTaskId(data);
          if (!taskId) return;
          offerRelease(taskId, claimedLine(posting, now));
        },
        onError: (error) => {
          if (claimLost(error)) {
            setLostClaims((lost) => ({
              readAt: openTasksReadAt,
              ids:
                lost.readAt === openTasksReadAt
                  ? new Set(lost.ids).add(posting.id)
                  : new Set([posting.id]),
            }));
            setNotice(TASK_AUDIENCE_COPY.alreadyClaimed);
            return;
          }
          setNotice(
            errorCopy(error, CLAIM_FAILED, { serverWritesForMembers: true }),
          );
        },
      });
    },
    [claimOpen, now, openTasksReadAt, offerRelease, setNotice, setCreated],
  );

  /**
   * Give a claimed task back to Up for grabs, from the toast. The task's
   * own screen offers it too, in its More (#5492).
   */
  const giveBack = useCallback(
    (taskId: string) => {
      clearUndo();
      setNotice(null);
      releaseTask.mutate(taskId, {
        onSuccess: () => {
          setCreated(RELEASED_LINE);
          AccessibilityInfo.announceForAccessibility(RELEASED_LINE);
        },
        onError: (error) =>
          setNotice(
            errorCopy(error, RELEASE_FAILED, { serverWritesForMembers: true }),
          ),
      });
    },
    [releaseTask, clearUndo, setNotice, setCreated],
  );

  // A posting's sheet, by id, so it redraws as the list reads again and
  // closes on nothing once the posting is gone.
  const postingRef = useRef<BottomSheetModal>(null);
  const [postingId, setPostingId] = useState<string | null>(null);
  const [postingProblem, setPostingProblem] = useState<string | null>(null);
  const [assigning, setAssigning] = useState<OpenTask | null>(null);
  const openPosting = useMemo(
    () => openTasks.find((posting) => posting.id === postingId) ?? null,
    [openTasks, postingId],
  );
  const postingFailed = useCallback((error: unknown) => {
    setPostingProblem(
      claimLost(error)
        ? TASK_AUDIENCE_COPY.alreadyClaimed
        : errorCopy(error, POSTING_FAILED),
    );
  }, []);
  const assignPosting = useCallback(
    (posting: OpenTask, userId: string) => {
      setPostingProblem(null);
      assignOpen.mutate(
        { id: posting.id, assigneeId: userId },
        {
          onSuccess: () => {
            postingRef.current?.dismiss();
            const text = taskCreatedLine(
              nameOf(userId),
              userId === viewerUserId,
            );
            setCreated(text);
            AccessibilityInfo.announceForAccessibility(text);
          },
          onError: postingFailed,
        },
      );
    },
    [assignOpen, nameOf, viewerUserId, postingFailed, setCreated],
  );
  const deletePosting = useCallback(
    (posting: OpenTask) => {
      Alert.alert(
        `Delete “${posting.title}”?`,
        `It comes off ${TASK_AUDIENCE_COPY.upForGrabs} for everyone.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: () => {
              setPostingProblem(null);
              deleteOpen.mutate(posting.id, {
                onSuccess: () => postingRef.current?.dismiss(),
                onError: postingFailed,
              });
            },
          },
        ],
      );
    },
    [deleteOpen, postingFailed],
  );

  function renderUpForGrabs() {
    if (openTasks.length === 0) {
      // A failed read says so in one line rather than leaving a member to
      // think nothing is open; nothing open draws nothing at all.
      return openTasksQuery.isError && openTasksQuery.data === undefined ? (
        <InlineNote>{`Couldn't load ${TASK_AUDIENCE_COPY.upForGrabs}. Pull down to try again.`}</InlineNote>
      ) : null;
    }
    return (
      <>
        <SectionHeader>
          {TASK_AUDIENCE_COPY.upForGrabs.toUpperCase()}
        </SectionHeader>
        <View>
          {openTasks.map((posting, index) => (
            <OpenTaskRow
              key={posting.id}
              posting={posting}
              now={now}
              isFirst={index === 0}
              onClaim={
                posting.viewer_can_claim ? () => claim(posting) : undefined
              }
              onOpen={() => {
                setPostingProblem(null);
                setPostingId(posting.id);
                postingRef.current?.present();
              }}
            />
          ))}
        </View>
      </>
    );
  }

  const renderRows = useCallback(
    (rows: TaskRowModel[]) => {
      // Both layouts take the same two targets: the box (dropped, not
      // disabled-in-place, while the sequence runs, since the task is
      // mid-ladder and a second tap would race the compare-and-set) and the
      // rest, which pushes the task's screen, where an officer's Edit sits.
      const props = (row: TaskRowModel) => ({
        row,
        now,
        isPending: pendingId === row.id,
        onToggle: canToggle(row) ? () => void toggle(row) : undefined,
        onOpen: () => openTask(row.id),
        menu: menuFor(row),
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
    [now, pendingId, canToggle, toggle, openTask, menuFor, layout, styles.grid],
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
      // place. The caption is a bar: which section comes first (TODAY, THIS
      // WEEK or LATER) depends on the tasks.
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
        <>
          {renderUpForGrabs()}
          {/* One line under the points card, not a card of its own
              (`writing.md` § 4, rule 7): the plate is clear, then what comes
              next, so the line says more than what isn't there. Web's Tasks
              board writes the same line (`nextUpLine`). An officer also hears
              where assigning lives, this screen's own + (New task, #4610). */}
          <InlineNote>
            {nextUpLine(eventsOn ? eventsQuery.data : undefined, now.getTime())}
            {canManageTasks ? " Tap + to assign a task." : null}
          </InlineNote>
        </>
      );
    }

    return (
      <>
        {/* Up for grabs leads, when anything is open: what a member could
            pick up, before their own list. */}
        {renderUpForGrabs()}
        {/* Today, This week, Later (#4295 step 5), each only when it has a
            task: on a phone an empty heading is a scroll for nothing. */}
        {MY_TASKS_GROUPS.map((group) =>
          board.groups[group].length > 0 ? (
            <Fragment key={group}>
              <SectionHeader>
                {MY_TASKS_GROUP_LABELS[group].toUpperCase()}
              </SectionHeader>
              {renderRows(board.groups[group])}
            </Fragment>
          ) : null,
        )}
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
          actionLabel={
            undo.action === "release" ? TASK_AUDIENCE_COPY.release : undefined
          }
          onUndo={() =>
            undo.action === "release"
              ? giveBack(undo.id)
              : void takeBack(undo.id)
          }
          aboveCreate={canCreate}
        />
      ) : null}

      <OpenTaskSheet
        ref={postingRef}
        posting={openPosting}
        who={openPosting ? openTaskWho(openPosting, nameOf) : null}
        busy={assignOpen.isPending || deleteOpen.isPending}
        problem={postingProblem}
        onClaim={
          openPosting?.viewer_can_claim
            ? () => {
                const posting = openPosting;
                postingRef.current?.dismiss();
                claim(posting);
              }
            : undefined
        }
        onAssign={
          canManageTasks && openPosting
            ? () => setAssigning(openPosting)
            : undefined
        }
        onDelete={
          canManageTasks && openPosting
            ? () => deletePosting(openPosting)
            : undefined
        }
        onDismiss={() => {
          setPostingId(null);
          setPostingProblem(null);
        }}
      />

      {assigning ? (
        <OpenTaskAssignPicker
          key={assigning.id}
          onPick={(userId) => assignPosting(assigning, userId)}
          onClosed={() => setAssigning(null)}
        />
      ) : null}

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
            offerGroups
            // Kept past this screen (#4593): going back and coming here again
            // opens New task on the draft left in it.
            keptDraft="tasks-create"
            onCreated={(assigneeName, wasSelf, upForGrabs) => {
              // Someone else's task is on no board here, so say where it went.
              const text = taskCreatedLine(assigneeName, wasSelf, upForGrabs);
              setCreated(text);
              AccessibilityInfo.announceForAccessibility(text);
            }}
          />
        </SheetBoundary>
      ) : null}

      <MarkDoneHost toggle={toggles} />

      {taskMenu.host}
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
