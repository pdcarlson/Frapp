import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import type { SignetTokens } from "@repo/theme/signet";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  ACTIVITY_SHOW_EVERYTHING,
  ACTIVITY_TO_DO_EMPTY,
  activityAgenda,
  activityCouldNotLoad,
  activityGroups,
  activityNarrowedNote,
  activityReview,
  activityWeekSummary,
  findActivityTaskRow,
  useActivity,
  useActivityStanding,
  useActivityUnread,
  useNowDate,
  useCurrentChapter,
  useClearActivityLinkState,
  useMyPermissions,
  useRemoveActivityLink,
  useRestoreActivityLink,
  useSetActivityLinkState,
  useViewerUserId,
  useActivityFaces,
  type ActivityAgendaDay,
  type ActivityAgendaFilter,
  type ActivityGroup,
  type ActivityPart,
  type ActivityRow,
} from "@repo/hooks";
import { describeLoadFailure, errorCopy } from "@repo/hooks/error-copy";
import { can, isModuleEnabled } from "@repo/validation";
import {
  ActivityFaces,
  ActivityListRow,
  ActivityRowSkeleton,
} from "@/components/activity/activity-row";
import {
  ActivityRowItem,
  useActivityRowActions,
  type ActivityRowActions,
} from "@/components/activity/activity-row-action";
import {
  ActivitySheet,
  type LinkSheetActions,
} from "@/components/activity/activity-sheet";
import { ReviewCard } from "@/components/activity/review-card";
import {
  SemesterStrip,
  SemesterStripSkeleton,
  type StandingDestination,
} from "@/components/activity/semester-strip";
import { WeekCard, WeekCardSkeleton } from "@/components/activity/week-card";
import { InlineNote } from "@/components/inline-note";
import { SectionCount, SectionHeader } from "@/components/list-section";
import { useRefetchAll } from "@/components/pull-to-refresh";
import { ScreenShell } from "@/components/screen-shell";
import { ErrorState, SkeletonRegion } from "@/components/state-block";
import { UNDO_WINDOW_MS, UndoBar } from "@/components/tasks/undo-bar";
import { activityRowActionsAllowed } from "@/lib/activity/row-action";
import { useActivityReread } from "@/lib/activity/use-activity-reread";
import { useChapterBranding } from "@/lib/chapter-branding";
import { openMessageLink } from "@/lib/chat/open-link";
import { pageSurfaces } from "@/lib/surfaces";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * Activity: the member's week, what they still have to do, and what waits on
 * others (#3897, `spec/behavior/activity.md`). An inbox beside chat, not a
 * home. Tab 2 since 2026-11-12 (#4610), whose icon carries the count of what
 * needs the member; the task board's door is on the title row.
 *
 * Rebuilt around one ring on 2026-11-13 (#4766; Paul: "too many little cards
 * that, with the scale that we have right now, tell me no information"). Top
 * to bottom:
 *
 * 1. The week card (`WeekCard`): done of total this week, a line per kind,
 *    and the one thing to do next.
 * 2. This semester (`SemesterStrip`): up to four gauges, two across.
 * 3. To review (`ReviewCard`): for an officer with something to sign off.
 * 4. To do: the member's own events, tasks, polls and sign-ups by day
 *    (`activityAgenda`), three to a day before "Show more". A line of the
 *    week card narrows it to one kind.
 * 5. Waiting on others, then Links: what the member made and what was posted
 *    for them, each left out when it has nothing.
 *
 * It is drawn and checked for four people (`principles.md` § Three people):
 * a member with nothing due, an average member, a committee chair and the
 * president. Web's `/activity` is the same page from the same model
 * (`apps/web/components/activity/activity-page.tsx`).
 *
 * A row opens the record in a sheet drawn with chat's own card, where the
 * member acts on it (`components/activity/activity-sheet.tsx`). The read is
 * never served fresh from cache (`useActivity`). It is read again when the
 * sheet closes, because the cards write through their own hooks, which this
 * read does not hear about, and whenever the member comes back to this
 * screen (`useActivityReread`).
 */
export default function ActivityScreen() {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const activity = useActivity();
  // The shared 30s clock the poll cards read: a poll whose time runs out
  // leaves the list within a tick, without a re-read (#4258), and the days
  // and Next stay current while the page is open.
  const now = useNowDate();
  const viewerId = useViewerUserId();
  // Faces on the rows (#4402, item 4), from the roster chat already reads.
  const faceFor = useActivityFaces();
  // Also on every return to this screen: it stays mounted under the thread
  // or event details it pushes, and a vote cast there is not heard here.
  const reread = useActivityReread({ standing: true });
  const chapterRead = useCurrentChapter();
  const chapter = chapterRead.data;
  const chapterModules = chapter?.enabled_modules;
  const moduleOn = useCallback(
    (key: string) => isModuleEnabled(chapterModules, key),
    [chapterModules],
  );
  const [openedKey, setOpenedKey] = useState<string | null>(null);
  // How the member is doing this semester, under the week. Its own read: a
  // failure leaves the rest of the page as it is. `useActivityReread` reads
  // it again with the list, on each return and after an action here.
  const standing = useActivityStanding();
  const router = useRouter();
  const openStanding = (destination: StandingDestination) => {
    // Calendar (the `events` route) is a tab: go to it rather than stack a
    // second copy. The task board is a pushed screen since #4610.
    if (destination === "/events") {
      router.navigate(destination);
    } else {
      router.push(destination);
    }
  };
  const refresh = useRefetchAll([activity, standing]);
  const { linkActions, undo, rereadOnClose } = useLinkActions();

  const permissions = useMyPermissions().data?.permissions;
  const summary = useMemo(
    () => (activity.data ? activityWeekSummary(activity.data, now) : null),
    [activity.data, now],
  );
  // The week line picked while the app is open. Never stored: a fresh launch
  // opens on everything. A line that has left the card (its module turned
  // off, or nothing of its kind in the week's count any more, as on a new
  // week) takes its narrowing with it for good, so the list doesn't narrow
  // itself again when the line comes back. Finishing the last item keeps the
  // line, at "3 of 3", and the list says nothing of that kind is left.
  const [picked, setPicked] = useState<ActivityAgendaFilter>("all");
  const pickedLineGone =
    picked !== "all" &&
    summary !== null &&
    !summary.lines.some((line) => line.id === picked);
  // Adjusted while rendering, as React documents for state that follows a
  // prop: no frame is drawn with the stale pick.
  if (pickedLineGone) setPicked("all");
  const filter: ActivityAgendaFilter =
    picked !== "all" && summary?.lines.some((line) => line.id === picked)
      ? picked
      : "all";
  const agenda = useMemo(
    () => (activity.data ? activityAgenda(activity.data, filter, now) : null),
    [activity.data, filter, now],
  );
  // Only for the roles that review: a member is never shown the card.
  const review = useMemo(
    () =>
      activity.data
        ? activityReview(
            activity.data,
            {
              canConfirmTasks:
                moduleOn("tasks") && can("tasks:manage", permissions ?? []),
            },
            now,
          )
        : null,
    [activity.data, permissions, moduleOn, now],
  );
  // What the member made, and the links posted for them, as the shared
  // groups build them, in order. Narrowed to a kind, the page is the To do
  // list alone.
  const groups = useMemo(
    () => (activity.data ? activityGroups(activity.data, now) : []),
    [activity.data, now],
  );
  const below =
    filter === "all"
      ? groups.filter(
          (group) =>
            group.rows.length > 0 ||
            group.archive !== null ||
            group.unavailable.length > 0,
        )
      : [];
  // The open row as the latest read has it. A row that has left the list (a
  // vote cast, a completion confirmed) is `null` here and the sheet keeps
  // drawing the one it was opened with, so the member sees the result of
  // what they just did.
  const openRow = useMemo(() => {
    if (openedKey === null) return null;
    const row = [
      ...(agenda?.rows ?? []),
      ...(review?.rows ?? []),
      ...groups.flatMap((group) => [
        ...group.rows,
        ...(group.archive?.rows ?? []),
      ]),
    ].find((candidate) => candidate.key === openedKey);
    return row ?? null;
  }, [agenda, review, groups, openedKey]);
  const [opened, setOpened] = useState<ActivityRow | null>(null);
  const sheetRow = openedKey === null ? null : (openRow ?? opened);

  // Dots (#4405): opening a row from here is what reads it; scrolling past
  // doesn't, and neither does acting on the item elsewhere in Frapp.
  const { markRead } = useActivityUnread(activity.data);
  const open = (row: ActivityRow) => {
    if (row.unread) markRead([row.readRef]);
    // A sign-up or form (#3926) is answered on its card: the row goes to
    // the message in chat rather than a sheet, as a link row goes to its
    // link.
    if (row.kind === "card") {
      router.push({
        pathname: "/chat-thread",
        params: {
          channelId: row.card.channel_id,
          focusMessageId: row.card.message_id,
        },
      });
      return;
    }
    setOpened(row);
    setOpenedKey(row.key);
  };
  // Confirm and Approve on the To review card's rows (#4437), and Check in
  // on the To do list's (#4427), while the chapter's plan allows them;
  // acting there reads the item, as opening it does, and re-reads so the
  // row leaves the card or the list.
  const { actions: rowActions, stateOf: rowActionStateOf } =
    useActivityRowActions({
      allowed: activityRowActionsAllowed(chapter),
      chapterPending: chapterRead.isPending === true,
      onActed: (row) => {
        if (row.unread) markRead([row.readRef]);
        reread();
      },
    });

  // `/activity?review=<taskId>`: a "submitted a task" push (targets.ts).
  // The read is taken again first, because the one in hand predates the
  // submission whenever the app was warm, then that task's sheet opens,
  // and the param is dropped so coming back to the tab doesn't open it
  // again. A task the read doesn't hold (confirmed from another device, or
  // past the read's cap) opens nothing: the officer lands on the page.
  const { review: reviewParam } = useLocalSearchParams<{ review?: string }>();
  const reviewTaskId =
    typeof reviewParam === "string" && reviewParam !== "" ? reviewParam : null;
  const refetchActivity = activity.refetch;
  useEffect(() => {
    if (reviewTaskId === null) return;
    let live = true;
    void refetchActivity().then((result) => {
      if (!live) return;
      const row = result.data
        ? findActivityTaskRow(result.data, reviewTaskId, new Date())
        : null;
      if (row) {
        if (row.unread) markRead([row.readRef]);
        setOpened(row);
        setOpenedKey(row.key);
      }
      router.setParams({ review: undefined });
    });
    return () => {
      live = false;
    };
    // Once per review linked; `markRead` is read when the read lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewTaskId, refetchActivity, router]);

  function renderBody() {
    if (activity.isPending) {
      return (
        <SkeletonRegion label="Loading activity">
          <View style={styles.body}>
            <WeekCardSkeleton />
            <SemesterStripSkeleton />
            <View>
              <SectionHeader>To do</SectionHeader>
              {Array.from({ length: 4 }, (_, index) => (
                <ActivityRowSkeleton
                  key={index}
                  index={index}
                  isFirst={index === 0}
                />
              ))}
            </View>
          </View>
        </SkeletonRegion>
      );
    }
    // Only with nothing to show: a re-read that fails (this screen re-reads
    // after every action) keeps the page it already has.
    if (activity.isError && !activity.data) {
      return (
        <ErrorState
          title="Couldn't load your activity"
          body={describeLoadFailure(activity.error)}
          onRetry={() => void activity.refetch()}
          isRetrying={activity.isFetching}
        />
      );
    }
    if (!summary || !agenda) return null;
    return (
      <View style={styles.body}>
        <WeekCard
          summary={summary}
          next={agenda.next}
          nextLabel={agenda.nextLabel}
          filter={filter}
          onFilter={setPicked}
          rowActions={rowActions}
          onOpenNext={open}
        />
        {standing.isPending ? (
          <SemesterStripSkeleton />
        ) : standing.data ? (
          <SemesterStrip standing={standing.data} onOpen={openStanding} />
        ) : null}
        {review ? (
          <ReviewCard review={review} rowActions={rowActions} onOpen={open} />
        ) : null}
        <ToDoSection
          days={agenda.days}
          unavailable={agenda.unavailable}
          filter={filter}
          // The one thing left is already on the week card.
          onCard={agenda.next !== null}
          onShowAll={() => setPicked("all")}
          rowActions={rowActions}
          onOpen={open}
        />
        {below.map((group) => (
          <GroupSection
            key={group.id}
            group={group}
            rowActions={rowActions}
            onOpen={open}
          />
        ))}
      </View>
    );
  }

  return (
    <ActivityFaces.Provider value={faceFor}>
      <ScreenShell
        title="Activity"
        refresh={refresh}
        headerAction={moduleOn("tasks") ? <TaskBoardLink /> : undefined}
      >
        {renderBody()}
        <ActivitySheet
          row={sheetRow}
          viewerId={viewerId}
          rowActionState={sheetRow ? rowActionStateOf(sheetRow.key) : "idle"}
          onActed={reread}
          onClosed={() => {
            setOpenedKey(null);
            if (rereadOnClose()) reread();
          }}
          linkActions={linkActions}
        />
      </ScreenShell>
      {undo ? (
        <UndoBar key={undo.key} message={undo.message} onUndo={undo.run} />
      ) : null}
    </ActivityFaces.Provider>
  );
}

/**
 * The task board's door (#4610): the board (List and Grid, the points card)
 * is a pushed screen now that Activity and Calendar hold a member's tasks.
 * Drawn only while the chapter has Tasks on, since the whole board is behind
 * that module. A plain neutral control on the title row, never the accent, which marks
 * only the one primary action (foundations.md § Where the accent goes).
 */
function TaskBoardLink() {
  const router = useRouter();
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Task board"
      accessibilityHint="Opens all of your tasks as a list or a grid."
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      onPress={() => router.push("/tasks")}
      style={({ pressed }) => [styles.boardLink, pressed && styles.pressed]}
    >
      <Text style={styles.boardLinkText}>Task board</Text>
    </Pressable>
  );
}

/**
 * The sign-up link writes (`spec/behavior/activity.md` § Links), owned by the
 * screen: each takes the row off the list at once, which closes its sheet,
 * and the "Undo" bar that follows (the tasks board's, for the same few
 * seconds) has to outlive the sheet. Remove is `channels:manage`'s, as in
 * chat. A write that fails puts the row back and says so.
 */
function useLinkActions() {
  const router = useRouter();
  const permissions = useMyPermissions();
  const markDone = useSetActivityLinkState("done");
  const hide = useSetActivityLinkState("hidden");
  const clearState = useClearActivityLinkState();
  const remove = useRemoveActivityLink();
  const restore = useRestoreActivityLink();
  const [undo, setUndo] = useState<{
    message: string;
    run: () => void;
    key: number;
  } | null>(null);
  const skipCloseReread = useRef(false);
  useEffect(() => {
    if (!undo) return undefined;
    const timer = setTimeout(() => setUndo(null), UNDO_WINDOW_MS);
    return () => clearTimeout(timer);
  }, [undo]);

  type LinkRow = Extract<ActivityRow, { kind: "link" }>;
  // Each write's own promise, not `mutate`'s per-call callbacks, which a
  // second Done before the first answers would cancel (`useLinkWrite`).
  type Write = { mutateAsync: (id: string) => Promise<unknown> };
  const failed = (title: string) => (error: unknown) =>
    Alert.alert(title, errorCopy(error));
  const act =
    (write: Write, message: string, takeBack: Write, failure: string) =>
    (row: LinkRow) => {
      // The sheet closes as this starts; the write re-reads Activity itself
      // when it settles, and a re-read on close would race it.
      skipCloseReread.current = true;
      write.mutateAsync(row.link.id).then(
        () =>
          setUndo((open) => ({
            message,
            // A new key per action, so the bar is announced again.
            key: (open?.key ?? 0) + 1,
            run: () => {
              setUndo(null);
              takeBack.mutateAsync(row.link.id).catch(failed("Couldn't undo"));
            },
          })),
        failed(failure),
      );
    };

  const linkActions: LinkSheetActions = {
    canRemove: can("channels:manage", permissions.data?.permissions ?? []),
    open: (row) => void openMessageLink(row.link.url),
    done: act(markDone, "Marked done", clearState, "Couldn't mark it done"),
    hide: act(hide, "Hidden", clearState, "Couldn't hide it"),
    remove: act(
      remove,
      "Removed from everyone's Activity",
      restore,
      "Couldn't remove it",
    ),
    openInChat: (row) =>
      // A thread reply isn't on the channel's timeline: open its thread.
      router.push({
        pathname: "/chat-thread",
        params: row.link.thread_root_id
          ? {
              channelId: row.link.channel_id,
              threadRootId: row.link.thread_root_id,
            }
          : { channelId: row.link.channel_id },
      }),
  };
  /** Whether the sheet's close should re-read; false once after a link write. */
  const rereadOnClose = () => {
    const skip = skipCloseReread.current;
    skipCloseReread.current = false;
    return !skip;
  };
  return { linkActions, undo, rereadOnClose };
}

/**
 * "To do": the member's own list by day (#4766), as Things' Today and
 * Todoist's Upcoming draw one. Overdue leads in the warning hue, then what
 * is open for check-in now, then each day. What waits on the member's review
 * is never here (`ReviewCard`).
 */
function ToDoSection({
  days,
  unavailable,
  filter,
  onCard,
  onShowAll,
  rowActions,
  onOpen,
}: {
  days: ActivityAgendaDay[];
  unavailable: ActivityGroup["unavailable"];
  filter: ActivityAgendaFilter;
  /** The week card holds the next thing, so an empty list isn't "nothing". */
  onCard: boolean;
  onShowAll: () => void;
  /** Check in on an open event's row (#4427); `null` while refused. */
  rowActions: ActivityRowActions | null;
  onOpen: (row: ActivityRow) => void;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const count = days.reduce((sum, day) => sum + day.rows.length, 0);
  // Its one thing is on the week card: a heading over nothing says nothing.
  if (count === 0 && onCard && filter === "all" && unavailable.length === 0) {
    return null;
  }
  return (
    <View style={styles.group}>
      <SectionHeader count={count || null}>To do</SectionHeader>
      {filter !== "all" ? (
        <InlineNote
          action={{ label: ACTIVITY_SHOW_EVERYTHING, onPress: onShowAll }}
        >
          {activityNarrowedNote(filter, count, unavailable.length > 0)}
        </InlineNote>
      ) : null}
      {unavailable.length > 0 ? (
        // A section the read could not load is said, never shown as empty:
        // "nothing to do" must not be a failed read.
        <InlineNote tone="warning">
          {`${activityCouldNotLoad(unavailable)} Pull down to try again.`}
        </InlineNote>
      ) : null}
      {count === 0 && filter === "all" && unavailable.length === 0 ? (
        <InlineNote>{ACTIVITY_TO_DO_EMPTY}</InlineNote>
      ) : null}
      {days.map((day) => (
        <DaySection
          key={day.id}
          day={day}
          rowActions={rowActions}
          onOpen={onOpen}
        />
      ))}
    </View>
  );
}

/**
 * One day of the To do list: its heading and count, its first few rows, and
 * "Show N more" for the rest, so the president's Saturday doesn't bury
 * Sunday. Overdue and Now are never cut (`day.limit` is `null`).
 */
function DaySection({
  day,
  rowActions,
  onOpen,
}: {
  day: ActivityAgendaDay;
  rowActions: ActivityRowActions | null;
  onOpen: (row: ActivityRow) => void;
}) {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens);
  const [expanded, setExpanded] = useState(false);
  const cappable = day.limit !== null && day.rows.length > day.limit;
  const rows =
    cappable && !expanded
      ? day.rows.slice(0, day.limit ?? undefined)
      : day.rows;
  const tone =
    day.tone === "warning"
      ? { color: tokens.color.semantic.warning }
      : day.tone === "accent"
        ? { color: accent }
        : // A day is the content's own label, in the foreground tone, as
          // the Calendar's day headings are (`DayHeading`, #4138).
          { color: tokens.color.text.foreground };
  return (
    <View testID={`activity-day-${day.id}`}>
      <View
        accessible
        accessibilityRole="header"
        accessibilityLabel={`${day.label}, ${day.rows.length}`}
        style={styles.partHeading}
      >
        <Text style={[styles.partLabel, tone]}>{day.label}</Text>
        <SectionCount count={day.rows.length} />
      </View>
      {rows.map((row, index) => (
        <ActivityRowItem
          key={row.key}
          row={row}
          isFirst={index === 0}
          actions={rowActions}
          onPress={() => onOpen(row)}
        />
      ))}
      {cappable ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          onPress={() => setExpanded((open) => !open)}
          style={styles.showAll}
        >
          <Text style={[styles.showAllText, { color: accent }]}>
            {expanded
              ? "Show fewer"
              : `Show ${day.rows.length - rows.length} more`}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * A group under the To do list: Waiting on others (the polls the member
 * posted, the events they made, the tasks they assigned), or Links. The
 * screen leaves a group with nothing in it out, so there is no empty line.
 */
function GroupSection({
  group,
  rowActions,
  onOpen,
}: {
  group: ActivityGroup;
  rowActions: ActivityRowActions | null;
  onOpen: (row: ActivityRow) => void;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  return (
    <View style={styles.group}>
      <SectionHeader count={group.rows.length || null}>
        {group.label}
      </SectionHeader>
      {group.unavailable.length > 0 ? (
        // A section the read could not load is said, never shown as empty.
        <InlineNote tone="warning">
          {`${activityCouldNotLoad(group.unavailable)} Pull down to try again.`}
        </InlineNote>
      ) : null}
      {group.parts.map((part) => (
        <GroupPart
          key={part.id}
          part={part}
          rowActions={rowActions}
          onOpen={onOpen}
        />
      ))}
      {group.archive ? (
        <ArchivePart part={group.archive} onOpen={onOpen} />
      ) : null}
    </View>
  );
}

/**
 * The rows a group keeps behind one control (#4258): the member's closed
 * polls, under Waiting on others, closed until pressed, as web draws them. Each
 * row opens the poll's card with its final result.
 */
function ArchivePart({
  part,
  onOpen,
}: {
  part: ActivityPart;
  onOpen: (row: ActivityRow) => void;
}) {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens);
  const [open, setOpen] = useState(false);
  const label = part.label ?? "Archive";
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((shown) => !shown)}
        style={styles.showAll}
      >
        <Text style={[styles.showAllText, { color: accent }]}>
          {open
            ? `Hide ${label.toLowerCase()}`
            : `${label} (${part.rows.length})`}
        </Text>
      </Pressable>
      {open
        ? part.rows.map((row, index) => (
            <ActivityListRow
              key={row.key}
              row={row}
              isFirst={index === 0}
              onPress={() => onOpen(row)}
            />
          ))
        : null}
    </View>
  );
}

/**
 * One run of a group's rows (#4173): one kind under Waiting on others, or
 * the whole group. A long part draws its first few rows and a "Show all" for
 * the rest, so one busy kind doesn't bury the screen. Drawn from
 * `group.parts`, never `group.rows`: the parts carry the caps and the
 * headings.
 */
function GroupPart({
  part,
  rowActions,
  onOpen,
}: {
  part: ActivityPart;
  rowActions: ActivityRowActions | null;
  onOpen: (row: ActivityRow) => void;
}) {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens);
  const [expanded, setExpanded] = useState(false);
  const cappable = part.limit !== null && part.rows.length > part.limit;
  const rows =
    cappable && !expanded
      ? part.rows.slice(0, part.limit ?? undefined)
      : part.rows;
  return (
    <View>
      {part.label ? (
        <View
          accessible
          accessibilityRole="header"
          accessibilityLabel={`${part.label}, ${part.rows.length}`}
          style={styles.partHeading}
        >
          <Text style={styles.partLabel}>{part.label}</Text>
          <SectionCount count={part.rows.length} />
        </View>
      ) : null}
      {rows.map((row, index) => (
        <ActivityRowItem
          key={row.key}
          row={row}
          isFirst={index === 0}
          actions={rowActions}
          onPress={() => onOpen(row)}
        />
      ))}
      {cappable ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          onPress={() => setExpanded((open) => !open)}
          style={styles.showAll}
        >
          <Text style={[styles.showAllText, { color: accent }]}>
            {expanded ? "Show fewer" : `Show all ${part.rows.length}`}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    // The cards and each group, a step further apart than the shell's own
    // gap, as web spaces its sections.
    body: {
      gap: tokens.spacing.lg,
    },
    boardLink: {
      minHeight: 36,
      paddingHorizontal: tokens.spacing.md,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: tokens.color.border.input,
      // The header round's fill (`HeaderButton`), in a worded capsule.
      backgroundColor: pageSurfaces(tokens).card,
      justifyContent: "center",
    },
    boardLinkText: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    pressed: { opacity: 0.7 },
    group: {
      gap: tokens.spacing.sm,
    },
    partHeading: {
      flexDirection: "row",
      alignItems: "baseline",
      gap: tokens.spacing.sm,
      paddingTop: tokens.spacing.sm,
      paddingBottom: tokens.spacing.xs,
    },
    partLabel: {
      ...typeRole({
        ...tokens.typography.role.caption,
        weight: tokens.typography.weight.semibold,
      }),
      color: tokens.color.text.mutedForeground,
    },
    // The touch floor, with the text on the gutter line.
    showAll: {
      alignSelf: "flex-start",
      minHeight: tokens.touch.minimum,
      justifyContent: "center",
    },
    showAllText: {
      ...typeRole({
        ...tokens.typography.role.label,
        weight: tokens.typography.weight.semibold,
      }),
    },
  });
}
