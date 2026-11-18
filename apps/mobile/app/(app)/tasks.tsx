import { describeLoadFailure } from "@repo/hooks/error-copy";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { AccessibilityInfo, StyleSheet, Text, View } from "react-native";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import {
  useActiveChapterId,
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
} from "@repo/hooks";
import { nextUpLine } from "@repo/formatting";
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
 * ## Why the board filters by assignee
 *
 * `GET /v1/tasks` serves a `tasks:manage` holder the chapter's whole task set.
 * s08 is drawn as a personal board, so `selectTaskRows` keeps only the viewer's
 * rows — see its header. An officer's review queue is a different surface with a
 * different shape, and is not this slice.
 */

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
    [now, pendingId, canToggle, toggle, openTask, layout, styles.grid],
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
          onUndo={() => void takeBack(undo.id)}
          aboveCreate={canCreate}
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
            offerEveryone
            // Kept past this screen (#4593): going back and coming here again
            // opens New task on the draft left in it.
            keptDraft="tasks-create"
            onCreated={(assigneeName, wasSelf) => {
              // Someone else's task is on no board here, so say where it went.
              const text = taskCreatedLine(assigneeName, wasSelf);
              setCreated(text);
              AccessibilityInfo.announceForAccessibility(text);
            }}
          />
        </SheetBoundary>
      ) : null}

      <MarkDoneHost toggle={toggles} />
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
