import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
import { AppState, Pressable, StyleSheet, Text, View } from "react-native";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import {
  useActiveChapterId,
  useCurrentUser,
  useLeaderboard,
  useMyPoints,
  usePermissionList,
  useTasks,
  useUpdateTaskStatus,
  useViewerUserId,
} from "@repo/hooks";
import { can } from "@repo/validation";
import { SignetTokens } from "@repo/theme/signet";
import { ScreenShell } from "@/components/screen-shell";
import { SectionHeader } from "@/components/list-section";
import {
  EmptyState,
  ErrorState,
  NoChapterState,
  SkeletonLines,
} from "@/components/state-block";
import { TaskRow } from "@/components/tasks/task-row";
import { PointsSummaryCard } from "@/components/tasks/points-summary-card";
import { NewTaskSheet } from "@/components/tasks/new-task-sheet";
import { useChapterBranding } from "@/lib/chapter-branding";
import { selectTaskRows, type TaskRowModel } from "@/lib/tasks/board";
import { selectHouseRank, selectPointsSummary } from "@/lib/tasks/points-card";
import { MODULE_REFUSAL_COPY, moduleRefusalOf } from "@/lib/module-refusal";
import {
  SUBSCRIPTION_REFUSAL_COPY,
  subscriptionRefusalOf,
} from "@/lib/subscription-refusal";
import { nextTapSequence } from "@/lib/tasks/transitions";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * s08 — the task board, with the points balance and house rank folded in
 * (`canvas-screens.dc.html`, `id="s08"`).
 *
 * This screen is the landing site for the routes S2 deleted: `points.tsx` and
 * `points-details.tsx` are gone, and `spec/ui/mobile/screens.md` records their
 * balance and rank as re-landing here as stat cards.
 *
 * Composition only. Every rule lives in `lib/tasks/` where it is unit-tested,
 * and every optimistic write lives in `packages/hooks` (#560) — the acceptance
 * criteria of #995 name both placements explicitly.
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
export default function TasksScreen() {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens, accent);
  const sheetRef = useRef<BottomSheetModal>(null);

  const chapterId = useActiveChapterId();
  const viewerUserId = useViewerUserId();
  // The query behind `useViewerUserId`, for its error state: that helper returns
  // `null` for *failed* as well as *pending*, and the board needs to tell them
  // apart or a dead `/v1/users/me` pins it on a skeleton with no way out.
  const viewerQuery = useCurrentUser();
  const tasksQuery = useTasks();
  const pointsQuery = useMyPoints("semester");
  const leaderboardQuery = useLeaderboard("semester");
  const updateStatus = useUpdateTaskStatus();

  // `can` from @repo/validation, not a bare `includes` — an owner's grant is the
  // wildcard `*`, so a membership test would hide the control from exactly the
  // people who assign work. The C2 pattern, verbatim.
  const permissions = usePermissionList();
  const canManageTasks = can("tasks:manage", permissions);

  // One clock for the whole render, so the two sections cannot straddle a tick
  // and disagree about what "today" means — but re-read whenever the screen is
  // focused. A tab is never unmounted and the JS context survives days of
  // backgrounding, so a mount-only clock would keep bucketing by the day the app
  // was opened, and the sheet's "Today" chip would file a task already overdue.
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
  const summary = useMemo(
    () => selectPointsSummary(pointsQuery.data),
    [pointsQuery.data],
  );
  const rank = useMemo(
    () => selectHouseRank(leaderboardQuery.data, viewerUserId),
    [leaderboardQuery.data, viewerUserId],
  );

  const [pendingId, setPendingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
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
      if (next === "active") setRefusal(null);
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

  const toggle = useCallback(
    async (row: TaskRowModel) => {
      const sequence = nextTapSequence(row.storedStatus, row.displayStatus);
      if (sequence.length === 0) return;
      if (inFlight.current.has(row.id)) return;

      inFlight.current.add(row.id);
      setPendingId(row.id);
      try {
        for (const status of sequence) {
          await updateStatus.mutateAsync({ id: row.id, body: { status } });
        }
      } catch (error) {
        // The hook has already reverted its own write and invalidated, so the
        // row redraws at whatever the server actually holds. A gate refusal
        // also says why and withdraws the toggles; anything else, a permission
        // 403 included, stays the quiet revert it always was, with the retap.
        if (subscriptionRefusalOf(error)) {
          setRefusal(SUBSCRIPTION_REFUSAL_COPY.taskStatus);
        } else if (moduleRefusalOf(error)) {
          setRefusal(MODULE_REFUSAL_COPY.taskStatus);
        }
      } finally {
        inFlight.current.delete(row.id);
        setPendingId(null);
      }
    },
    [updateStatus],
  );

  const renderRows = useCallback(
    (rows: TaskRowModel[]) =>
      rows.map((row) => {
        const busy = pendingId === row.id;
        const pressable =
          !busy &&
          refusal === null &&
          nextTapSequence(row.storedStatus, row.displayStatus).length > 0;
        return (
          <TaskRow
            key={row.id}
            row={row}
            now={now}
            isPending={busy}
            // Dropped, not disabled-in-place, while the sequence runs: the row
            // is mid-ladder, so a second tap would race the compare-and-set.
            onToggle={pressable ? () => void toggle(row) : undefined}
          />
        );
      }),
    [now, pendingId, refusal, toggle],
  );

  function renderBoard() {
    // `useTasks` carries no `enabled: !!chapterId` guard, unlike every sibling
    // read, so without this gate it fires without a scope and surfaces an error
    // where "pick a chapter" is the honest answer.
    if (!chapterId) return <NoChapterState noun="your tasks" />;

    // Checked before the pending gate below, because `useViewerUserId` reports a
    // failed `/v1/users/me` as `null` too. Without this branch a 500 there
    // leaves the board shimmering forever with no retry — the exact "blip at
    // launch leaves a screen dead until a force-quit" case `state-block.tsx`
    // says `onRetry` exists to prevent, and `ScreenShell` is frozen so there is
    // no pull-to-refresh escape.
    if (viewerQuery.isError) {
      return (
        <ErrorState
          title="Couldn't load your account"
          body="Your tasks are filtered to you, so this has to load first."
          onRetry={() => void viewerQuery.refetch()}
          isRetrying={viewerQuery.isFetching}
        />
      );
    }

    // `viewerUserId === null` here is "/v1/users/me has not answered yet", not
    // "no tasks". Treating it as empty flashes "You're all clear" on every cold
    // start, a beat before the real rows land.
    if (tasksQuery.isPending || viewerUserId === null) {
      return <SkeletonLines lines={3} />;
    }

    if (tasksQuery.isError) {
      return (
        <ErrorState
          title="Couldn't load your tasks"
          body="Your task board is still here — this was a problem fetching it."
          onRetry={() => void tasksQuery.refetch()}
          isRetrying={tasksQuery.isFetching}
        />
      );
    }

    if (board.total === 0) {
      return (
        <EmptyState
          glyph="✓"
          title="You're all clear"
          body={
            canManageTasks
              ? "Nothing is assigned to you. Tap + to assign a task."
              : "Nothing is assigned to you right now."
          }
        />
      );
    }

    return (
      <>
        {board.dueThisWeek.length > 0 ? (
          <>
            <SectionHeader>DUE THIS WEEK</SectionHeader>
            <View style={styles.rows}>{renderRows(board.dueThisWeek)}</View>
          </>
        ) : null}

        {board.later.length > 0 ? (
          <>
            <SectionHeader>LATER</SectionHeader>
            <View style={styles.rows}>{renderRows(board.later)}</View>
          </>
        ) : null}
      </>
    );
  }

  return (
    <ScreenShell
      title="Tasks"
      subtitle="What you owe the chapter, and what it has earned you."
      headerAction={
        canManageTasks ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="New task"
            hitSlop={tokens.spacing.sm}
            onPress={() => {
              setNotice(null);
              sheetRef.current?.present();
            }}
            style={({ pressed }) => [
              styles.headerAction,
              pressed ? styles.headerActionPressed : null,
            ]}
          >
            <Text style={styles.headerActionGlyph}>+</Text>
          </Pressable>
        ) : undefined
      }
    >
      <PointsSummaryCard summary={summary} rank={rank} />

      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      {refusal ? <Text style={styles.refusal}>{refusal}</Text> : null}

      {renderBoard()}

      <NewTaskSheet
        ref={sheetRef}
        now={now}
        // A task assigned to someone else never appears on this board, so
        // dismissing into an unchanged screen reads as a failed create.
        onCreated={(assigneeName, wasSelf) =>
          setNotice(
            wasSelf
              ? null
              : `Assigned to ${assigneeName ?? "your chapter member"}.`,
          )
        }
      />
    </ScreenShell>
  );
}

function createStyles(tokens: SignetTokens, accent: string) {
  return StyleSheet.create({
    headerAction: {
      width: 38,
      height: 38,
      // TODO-DESIGN: Canvas draws radius 11; `navItem` is 10 and is the nearest
      // role in the locked radius map (foundations.md § Radius).
      borderRadius: tokens.radius.navItem,
      backgroundColor: accent,
      alignItems: "center",
      justifyContent: "center",
    },
    headerActionPressed: {
      opacity: 0.85,
    },
    headerActionGlyph: {
      ...typeRole(tokens.typography.role.title),
      // Drawn on house gold. The chapter accent is free to differ, and a dark
      // ink on an arbitrary accent is the contrast hazard `service-hours.tsx`
      // already carries — matched here rather than diverged from, and filed.
      color: tokens.color.gold.onHouse,
    },
    rows: {
      gap: tokens.spacing.sm,
    },
    notice: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    refusal: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructive,
    },
  });
}
