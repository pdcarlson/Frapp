import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  BackHandler,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { SignetTokens } from "@repo/theme/signet";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import {
  ACTIVITY_ARCHIVE_EMPTY,
  ACTIVITY_ARCHIVE_SECTION_NAMES,
  activityCardRole,
  arrangeActivityCards,
  sameActivityArrangement,
  useActivityLayout,
  useResetActivityLayout,
  useSaveActivityLayout,
  type ActivityCardArrangement,
  ACTIVITY_SHOW_EVERYTHING,
  ACTIVITY_TO_DO_EMPTY,
  activityAgenda,
  activityArchiveGroups,
  activityAwake,
  activitySnoozedRows,
  activityCouldNotLoad,
  activityGroups,
  activityNarrowedNote,
  activityReview,
  activityWeekStrip,
  activityWeekSummary,
  activityReviewRow,
  activityRowAwaitsReview,
  activityRowTaskId,
  findActivityTaskRow,
  taskAwaitsReview,
  useActivity,
  useFetchTask,
  useActivityArchive,
  useActivitySnoozeWake,
  useActivityRecap,
  useActivityStanding,
  useActivityUnread,
  useNowDate,
  useCurrentChapter,
  useClearActivityLinkState,
  useActivityNudge,
  useActivityNudgeActions,
  useMyPermissions,
  useRemoveActivityLink,
  useRestoreActivityLink,
  useSetActivityNudgesEnabled,
  type ActivityNudge,
  useSetActivityLinkState,
  useViewerUserId,
  useActivityFaces,
  useClearMessageReminder,
  type ActivityAgendaDay,
  type ActivityAgendaFilter,
  type ActivityArchiveGroup,
  type ActivityGroup,
  type ActivityPart,
  type ActivityRow,
  type ActivityGroupsOptions,
  type ActivityStripDay,
} from "@repo/hooks";
import { describeLoadFailure } from "@repo/hooks/error-copy";
import { messageReminderPresetTime } from "@repo/hooks/use-message-reminders";
import { can, isModuleEnabled } from "@repo/validation";
import {
  ActivityFaces,
  ActivityListRow,
  ActivityRowMenuContext,
  ActivityRowSkeleton,
} from "@/components/activity/activity-row";
import { useActivityRowMenu } from "@/components/activity/activity-row-menu";
import type { ItemMenuHandle } from "@/components/item-actions-menu";
import {
  ActivityRowItem,
  useActivityRowActions,
  type ActivityRowActions,
} from "@/components/activity/activity-row-action";
import {
  ActivitySheet,
  type LinkSheetActions,
  type ReminderSheetActions,
} from "@/components/activity/activity-sheet";
import { ActivityEditor } from "@/components/activity/activity-editor";
import { NudgeCard } from "@/components/activity/nudge-card";
import {
  activityNudgeAskPrompt,
  nudgeShowsRow,
  withoutWeekNext,
} from "@/lib/activity/nudge";
import { RecapCard, recapDismissal } from "@/components/activity/recap-card";
import { ReviewCard } from "@/components/activity/review-card";
import {
  SemesterStrip,
  SemesterStripSkeleton,
  type StandingDestination,
} from "@/components/activity/semester-strip";
import { WeekCard, WeekCardSkeleton } from "@/components/activity/week-card";
import { WeekStrip, WeekStripSkeleton } from "@/components/activity/week-strip";
import { DisclosureGlyph } from "@/components/control-glyphs";
import { LEAD_TILE_GLYPH, LeadTile } from "@/components/lead-tile";
import { NavGlyph } from "@/components/nav-glyph";
import { AskSheet } from "@/components/ask/ask-sheet";
import { InlineNote } from "@/components/inline-note";
import { SectionCount, SectionHeader } from "@/components/list-section";
import { useRefetchAll } from "@/components/pull-to-refresh";
import { ScreenShell } from "@/components/screen-shell";
import { ErrorState, SkeletonRegion } from "@/components/state-block";
import { UNDO_WINDOW_MS, UndoBar } from "@/components/tasks/undo-bar";
import { reviewTaskOf } from "@/lib/activity/review-task";
import { activityRowActionsAllowed } from "@/lib/activity/row-action";
import { useActivityReread } from "@/lib/activity/use-activity-reread";
import { useAiSurfaces } from "@/lib/ai/availability";
import { useChapterBranding } from "@/lib/chapter-branding";
import { useRemindMessage } from "@/lib/chat/message-reminder";
import { openMessageLink } from "@/lib/chat/open-link";
import { alertFailure } from "@/lib/failure-alert";
import { pageSurfaces } from "@/lib/surfaces";
import { typeRole, useFrappTheme } from "@/lib/theme";
import { NOTIFICATION_TILE_HUE } from "@repo/hooks/notification-rows";
import { NAV_GLYPHS } from "@repo/theme/nav-glyphs";
import { localIsoDate } from "@repo/formatting";
import type { ActivityCardKey } from "@repo/validation";

/**
 * Tasks you assigned from `task_items` (#5492): a task for everyone is one
 * row, which opens its group on the task's screen.
 */
const GROUP_OPTIONS: ActivityGroupsOptions = { taskItems: true };

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
 * 0. The week strip (`WeekStrip`, #5310): today and the next six days, a
 *    dot per kind due on each; pressing a day jumps To do to it.
 * 1. The week card (`WeekCard`): done of total this week, a line per kind,
 *    and the one thing to do next.
 * 2. This semester (`SemesterStrip`): up to four gauges, two across.
 * 3. To review (`ReviewCard`): for an officer with something to sign off.
 * 4. To do: the member's own events, tasks, polls and sign-ups by day
 *    (`activityAgenda`), three to a day before "Show more". A line of the
 *    week card narrows it to one kind. Under it, the Calendar row opens the
 *    chapter's whole month (#5310: Calendar folds into Activity).
 * 5. Reminders, Waiting on others, then Links: the chat messages the member
 *    asked to be reminded about (#4957), what they made, and what was posted
 *    for them, each left out when it has nothing.
 *
 * It is drawn and checked for four people (`principles.md` § Three people):
 * a member with nothing due, an average member, a committee chair and the
 * president. Web's `/activity` is the same page from the same model
 * (`apps/web/components/activity/activity-page.tsx`).
 *
 * A task row pushes the task's own screen (#5492), a task for everyone the
 * copy that carries its group; any other row opens the record in a sheet
 * drawn with chat's own card, where the member acts on it
 * (`components/activity/activity-sheet.tsx`), as does a completion waiting on
 * the member's sign-off. A long press on a task or event row opens the
 * board's and the Calendar's menu, with Snooze in it where it applies
 * (`useActivityRowMenu`). The read is never served fresh from cache
 * (`useActivity`). It is read again when the sheet closes, because the cards
 * write through their own hooks, which this read does not hear about, after
 * a write from a row's menu, and whenever the member comes back to this
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
  // Last week, on Sunday to Tuesday only (`useActivityRecap` reads nothing
  // the rest of the week), drawn once it lands.
  const recap = useActivityRecap();
  // Read the stored dismissals now, well before the recap lands, so a card
  // the member closed isn't drawn for a frame first.
  useEffect(() => {
    void recapDismissal.hydrate();
  }, []);
  const router = useRouter();
  // Every destination is a pushed screen: the task board since #4610, and
  // Calendar (the `events` route) since #5310.
  const openStanding = (destination: StandingDestination) => {
    router.push(destination);
  };
  // The Archive (#5127) in place of the page until the member goes back.
  // Read only while it is open; never stored.
  const [showArchive, setShowArchive] = useState(false);
  const archive = useActivityArchive({ enabled: showArchive });
  // Android's back button goes back to the page, as the Archive's own
  // control does, rather than leaving the tab.
  useEffect(() => {
    // Android only: iOS has no back button, and web has no BackHandler.
    if (!showArchive || Platform.OS !== "android") return undefined;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      setShowArchive(false);
      return true;
    });
    return () => sub.remove();
  }, [showArchive]);
  const { linkActions, undo, rereadOnClose, skipNextCloseReread } =
    useLinkActions();
  const reminderActions = useReminderActions(skipNextCloseReread);

  const permissionsRead = useMyPermissions();
  const permissions = permissionsRead.data?.permissions;
  // The member's cards, in their order (#5520, § Cards): saved on their
  // account so web draws the same page, and their role's default until they
  // save one, or while the read is out or failed.
  const layout = useActivityLayout();
  const cardRole = activityCardRole(permissions);
  const arrangement = useMemo(
    () => arrangeActivityCards(layout.data, cardRole),
    [layout.data, cardRole],
  );
  const shows = (key: ActivityCardKey) => arrangement.shown.includes(key);
  // Pull to refresh reads the arrangement too, so an edit made on web shows.
  const refreshPage = useRefetchAll([activity, standing, layout]);
  const refreshArchive = useRefetchAll([archive]);
  const refresh = showArchive ? refreshArchive : refreshPage;
  const saveLayout = useSaveActivityLayout();
  const resetLayout = useResetActivityLayout();
  // Edit Activity in place of the page, as the Archive is, until Done (or
  // Android's back button, which the editor takes as Done). Offered only once
  // the member's arrangement and role are known: an editor opened on the
  // default would save it over their own.
  const [editing, setEditing] = useState(false);
  const canEdit = layout.isSuccess && permissionsRead.data !== undefined;
  const finishEditing = (next: ActivityCardArrangement) => {
    setEditing(false);
    if (sameActivityArrangement(next, arrangement)) return;
    saveLayout.mutate(next, {
      onError: (error) =>
        alertFailure({
          title: "Couldn't save your cards",
          error,
          fallback: "Your cards are back the way they were saved.",
        }),
    });
  };
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
  // What the lists show: the read less what the member snoozed, on the
  // screen's own clock, so a snoozed row comes back within a tick of its
  // time (#4982). The week card counts from the whole read: snoozing
  // something doesn't finish it.
  const visible = useMemo(
    () => (activity.data ? activityAwake(activity.data, now) : undefined),
    [activity.data, now],
  );
  const snoozedRows = useMemo(
    () => (activity.data ? activitySnoozedRows(activity.data, now) : []),
    [activity.data, now],
  );
  // A read when the soonest snooze ends, for its dot and the tab's badge.
  useActivitySnoozeWake(activity.data);
  const agenda = useMemo(
    () => (visible ? activityAgenda(visible, filter, now) : null),
    [visible, filter, now],
  );
  // The week strip (#5310) counts what is awake, whatever line narrows To
  // do. Pressing a day scrolls To do to it: the screen holds the scroll view
  // and each day section's view, measured against it at the press.
  const strip = useMemo(
    () =>
      visible
        ? activityWeekStrip(visible, now, agenda?.next?.key ?? null)
        : null,
    [visible, now, agenda],
  );
  const scrollRef = useRef<ScrollView>(null);
  const sectionViews = useRef(new Map<string, View>());
  const bodyView = useRef<View>(null);
  const bodyTop = useRef(0);
  const sectionRef = useCallback(
    (id: string) => (view: View | null) => {
      if (view) sectionViews.current.set(id, view);
      else sectionViews.current.delete(id);
    },
    [],
  );
  // The day last jumped to, by its date, so it stays picked across a
  // re-read and lets go at midnight when it is no longer on the strip.
  const [jumpedDay, setJumpedDay] = useState<string | null>(null);
  const [pendingJump, setPendingJump] = useState<ActivityStripDay | null>(null);
  const jumpTo = useCallback(
    (day: ActivityStripDay) => {
      const scroll = scrollRef.current;
      if (!scroll) return;
      const target = day.sections
        .map((id) => sectionViews.current.get(id))
        .find((view) => view !== undefined);
      // The day's one thing is the week card's Next: the top of the page.
      if (!target) {
        scroll.scrollTo({ y: 0, animated: true });
        return;
      }
      // Measured against the page's own body, a host view (a node handle
      // is refused under the New Architecture), whose offset in the scroll
      // content its layout reports.
      const body = bodyView.current;
      if (!body) return;
      target.measureLayout(body, (_x, y) => {
        scroll.scrollTo({
          y: Math.max(0, bodyTop.current + y - tokens.spacing.sm),
          animated: true,
        });
      });
    },
    [tokens.spacing.sm],
  );
  const selectStripDay = (day: ActivityStripDay) => {
    setJumpedDay(localIsoDate(day.date));
    if (filter !== "all") {
      // A narrowed list may not hold the day: show everything, then jump
      // once the full list has drawn.
      setPicked("all");
      setPendingJump(day);
    } else {
      jumpTo(day);
    }
  };
  useEffect(() => {
    if (!pendingJump || filter !== "all") return undefined;
    const frame = requestAnimationFrame(() => {
      jumpTo(pendingJump);
      setPendingJump(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [pendingJump, filter, jumpTo]);
  const stripSelectedId =
    strip?.find((day) => localIsoDate(day.date) === jumpedDay)?.id ?? null;
  // Only for the roles that review: a member is never shown the card.
  const review = useMemo(
    () =>
      visible && activity.data
        ? activityReview(
            visible,
            {
              canConfirmTasks:
                moduleOn("tasks") && can("tasks:manage", permissions ?? []),
              served: activity.data,
            },
            now,
          )
        : null,
    [visible, activity.data, permissions, moduleOn, now],
  );
  // What the member made, and the links posted for them, as the shared
  // groups build them, in order. Narrowed to a kind, the page is the To do
  // list alone. A task for everyone the member assigned is one row (#5492).
  const groups = useMemo(
    () => (visible ? activityGroups(visible, now, GROUP_OPTIONS) : []),
    [visible, now],
  );
  const below =
    filter === "all"
      ? groups.filter(
          (group) => group.rows.length > 0 || group.unavailable.length > 0,
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
      ...groups.flatMap((group) => group.rows),
      ...snoozedRows,
    ].find((candidate) => candidate.key === openedKey);
    return row ?? null;
  }, [agenda, review, groups, snoozedRows, openedKey]);
  const [opened, setOpened] = useState<ActivityRow | null>(null);
  const sheetRow = openedKey === null ? null : (openRow ?? opened);

  // The card at the top (#5464): the one most useful thing waiting on the
  // member, and a tray of the next few, picked by the server from Activity's
  // own reads. It shows with or without AI; AI only adds a sentence, so it is
  // asked for on every Activity. Any failure is no card. It is asked again
  // after acting on what it or the week card's Next opened: when their sheet
  // closes, when the member comes back from the task screen they pushed, and
  // after a write from a row's menu.
  // A hidden card isn't asked for: the read can cost a model call.
  // It waits for the arrangement, so a member who hid it never sends one.
  const nudgeRead = useActivityNudge({
    enabled: !layout.isPending && shows("nudge"),
  });
  // Never the week card's Next a second time: when the card's pick is the
  // Next row, the tray's first takes its place.
  const nudge = useMemo(
    () => withoutWeekNext(nudgeRead.data, agenda?.next?.key ?? null),
    [nudgeRead.data, agenda?.next?.key],
  );
  const nudgeActions = useActivityNudgeActions();
  const recheckNudge = nudgeActions.recheck;
  const recheckOnReturn = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (recheckOnReturn.current) {
        recheckOnReturn.current = false;
        void recheckNudge();
      }
      return undefined;
    }, [recheckNudge]),
  );
  // A row's long press (#5492): its task's or event's menu, with Snooze
  // where it applies (#4982). A write from it reads the page again, and asks
  // the card again.
  const afterMenuWrite = useCallback(() => {
    reread();
    void recheckNudge();
  }, [reread, recheckNudge]);
  const rowMenu = useActivityRowMenu({ onWrote: afterMenuWrite });
  // One Undo bar at a time, the newest: a link's Done and a menu's Mark
  // done each replace the other's bar rather than wait behind it, so no
  // window runs out unseen. Adjusted while rendering, as React documents for
  // state that follows a prop.
  const linkUndoKey = undo?.key ?? null;
  const taskUndoKey = rowMenu.undoKey;
  const [undoOrder, setUndoOrder] = useState<{
    link: number | null;
    task: number | null;
    newest: "link" | "task";
  }>({ link: linkUndoKey, task: taskUndoKey, newest: "link" });
  if (undoOrder.link !== linkUndoKey || undoOrder.task !== taskUndoKey) {
    const newest =
      taskUndoKey !== null && taskUndoKey !== undoOrder.task
        ? "task"
        : linkUndoKey !== null && linkUndoKey !== undoOrder.link
          ? "link"
          : undoOrder.newest;
    setUndoOrder({ link: linkUndoKey, task: taskUndoKey, newest });
  }
  const undoShown: "link" | "task" | null =
    taskUndoKey !== null &&
    (linkUndoKey === null || undoOrder.newest === "task")
      ? "task"
      : linkUndoKey !== null
        ? "link"
        : null;

  // Who may sign off a completion (#5492): a row whose task waits on this
  // viewer's review opens as one, wherever it sits (`activityRowAwaitsReview`,
  // the sheet's rule too).
  const reviewer = useMemo(
    () => ({
      viewerId,
      canManage: moduleOn("tasks") && can("tasks:manage", permissions ?? []),
    }),
    [viewerId, moduleOn, permissions],
  );

  // Dots (#4405): opening a row from here is what reads it; scrolling past
  // doesn't, and neither does acting on the item elsewhere in Frapp.
  const { markRead } = useActivityUnread(activity.data);
  const open = (row: ActivityRow) => {
    if (row.unread && row.readRef) markRead([row.readRef]);
    // A task is its own screen (#5492; Paul, 2026-11-18: the sheet was
    // "lazy"), as on the board and the Calendar; a task for everyone opens
    // the copy that carries its group. A completion waiting on the viewer's
    // sign-off still opens the sheet, which holds Confirm and Send back.
    const taskId = activityRowAwaitsReview(row, reviewer)
      ? null
      : activityRowTaskId(row);
    if (taskId !== null) {
      // What the card or the week card's Next opened is asked again on the
      // way back, as a sheet's close asks it.
      if (nudgeShowsRow(nudge, row.key) || row.key === agenda?.next?.key) {
        recheckOnReturn.current = true;
      }
      router.push({ pathname: "/task-details", params: { id: taskId } });
      return;
    }
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
        if (row.unread && row.readRef) markRead([row.readRef]);
        reread();
      },
    });

  // `/activity?review=<taskId>`: a "submitted a task" push (targets.ts).
  // The read is taken again first, because the one in hand predates the
  // submission whenever the app was warm, then that task opens as a press on
  // its row opens it, and the param is dropped so coming back to the tab
  // doesn't open it again. A task the read lists no row for (a copy of a
  // task for everyone, whose row names only the copy it opens, #5492; or one
  // past the read's cap) is read by its id (`GET /v1/tasks/:id`): still
  // waiting on the viewer's sign-off, it opens its review sheet; otherwise
  // its own screen. One the read refuses (deleted since) opens nothing, and
  // the officer lands on the page.
  const { review: reviewParam } = useLocalSearchParams<{ review?: string }>();
  const reviewTaskId =
    typeof reviewParam === "string" && reviewParam !== "" ? reviewParam : null;
  const refetchActivity = activity.refetch;
  const fetchTask = useFetchTask();
  useEffect(() => {
    if (reviewTaskId === null) return;
    let live = true;
    void (async () => {
      const result = await refetchActivity();
      if (!live) return;
      const row = result.data
        ? findActivityTaskRow(
            result.data,
            reviewTaskId,
            new Date(),
            GROUP_OPTIONS,
          )
        : null;
      // Dropped first: opening may push a screen, whose params these
      // would then be.
      router.setParams({ review: undefined });
      if (row) {
        open(row);
        return;
      }
      const read = await fetchTask(reviewTaskId).catch(() => null);
      const task = read ? reviewTaskOf(read, (id) => faceFor(id)?.name) : null;
      if (!live || !task) return;
      if (taskAwaitsReview(task, reviewer)) {
        const review = activityReviewRow(task, new Date());
        setOpened(review);
        setOpenedKey(review.key);
      } else {
        router.push({ pathname: "/task-details", params: { id: task.id } });
      }
    })();
    return () => {
      live = false;
    };
    // Once per review linked; `open`, the viewer and the names are read
    // when the reads land.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewTaskId, refetchActivity, router]);

  const ai = useAiSurfaces();
  const setNudgesEnabled = useSetActivityNudgesEnabled();
  const askRef = useRef<BottomSheetModal>(null);
  const [askDraft, setAskDraft] = useState<string | null>(null);
  // Mounted on the first "Ask about this", then presented once it has.
  useEffect(() => {
    if (askDraft !== null) askRef.current?.present();
  }, [askDraft]);
  // A target this build can't open (a newer server's, or one with no id)
  // waves the card off rather than leaving a button that does nothing.
  const openNudge = (item: ActivityNudge) => {
    if (!openNudgeTarget(item)) nudgeActions.dismiss(item);
  };
  const openNudgeTarget = (item: ActivityNudge): boolean => {
    const id = item.target_id;
    switch (item.target_type) {
      case "task": {
        const row =
          activity.data && id
            ? findActivityTaskRow(activity.data, id, new Date(), GROUP_OPTIONS)
            : null;
        // Past the read's cap, or finished since: the board has every task.
        if (row) open(row);
        else router.push("/tasks");
        return true;
      }
      case "event":
        if (!id) return false;
        router.push({ pathname: "/event-details", params: { id } });
        return true;
      case "message":
        if (!item.channel_id || !id) return false;
        router.push({
          pathname: "/chat-thread",
          params: { channelId: item.channel_id, focusMessageId: id },
        });
        return true;
      case "channel":
        if (!id) return false;
        router.push({ pathname: "/chat-thread", params: { channelId: id } });
        return true;
      case "review": {
        // The oldest waiting, where the member confirms or approves it. A
        // snoozed one isn't on the card, so it opens from the whole read.
        const rows = review?.rows ?? [];
        const row =
          rows.find((r) => id !== null && r.key.endsWith(`:${id}`)) ??
          (activity.data && id
            ? findActivityTaskRow(activity.data, id, new Date(), GROUP_OPTIONS)
            : null) ??
          rows[0];
        if (row) open(row);
        else router.push("/tasks");
        return true;
      }
      case "meeting":
        if (!id) return false;
        router.push({ pathname: "/minutes-details", params: { id } });
        return true;
      case "study":
        router.push("/study");
        return true;
      default:
        return false;
    }
  };

  function renderBody() {
    if (editing) {
      return (
        <ActivityEditor
          initial={arrangement}
          role={cardRole}
          saved={layout.data?.saved ?? false}
          onDone={finishEditing}
          onReset={() => {
            setEditing(false);
            resetLayout.mutate(undefined, {
              onError: (error) =>
                alertFailure({ title: "Couldn't reset your cards", error }),
            });
          }}
        />
      );
    }
    if (showArchive) {
      return (
        <ArchiveView
          query={archive}
          viewerId={viewerId}
          now={now}
          onBack={() => setShowArchive(false)}
          onOpen={open}
          menuFor={rowMenu.archiveMenuFor}
        />
      );
    }
    if (activity.isPending) {
      return (
        <>
          <SkeletonRegion label="Loading activity">
            <View style={styles.body}>
              <WeekStripSkeleton />
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
          {/* The month needs none of this read, so its door is never gone. */}
          {shows("calendar") ? <CalendarRow /> : null}
        </>
      );
    }
    // Only with nothing to show: a re-read that fails (this screen re-reads
    // after every action) keeps the page it already has.
    if (activity.isError && !activity.data) {
      return (
        <>
          <ErrorState
            title="Couldn't load your activity"
            body={describeLoadFailure(activity.error)}
            onRetry={() => void activity.refetch()}
            isRetrying={activity.isFetching}
          />
          {shows("calendar") ? <CalendarRow /> : null}
        </>
      );
    }
    if (!summary || !agenda) {
      return shows("calendar") ? <CalendarRow /> : null;
    }
    // Each card the member may move or hide, drawn where their arrangement
    // puts it. A card with nothing in it is null, as before: no empty card.
    // Narrowed to a kind by the week card, the page is the To do list, so the
    // groups under it step out.
    const group = (id: (typeof below)[number]["id"]) => {
      const found = below.find((g) => g.id === id);
      return found ? (
        <GroupSection group={found} rowActions={rowActions} onOpen={open} />
      ) : null;
    };
    const cards: Record<ActivityCardKey, ReactNode> = {
      nudge: nudge?.card ? (
        <NudgeCard
          card={nudge.card}
          tray={nudge.tray}
          canAsk={ai.ask}
          onOpen={openNudge}
          onAsk={(item) => setAskDraft(activityNudgeAskPrompt(item))}
          onDismiss={(item) => nudgeActions.dismiss(item)}
          onTurnOff={() => setNudgesEnabled.mutate(false)}
          onSeen={(id) => nudgeActions.markSeen(id)}
        />
      ) : null,
      recap: recap.data ? <RecapCard recap={recap.data} now={now} /> : null,
      semester: standing.isPending ? (
        <SemesterStripSkeleton />
      ) : standing.data ? (
        <SemesterStrip standing={standing.data} onOpen={openStanding} />
      ) : null,
      review: review ? (
        <ReviewCard review={review} rowActions={rowActions} onOpen={open} />
      ) : null,
      todo: (
        <ToDoSection
          days={agenda.days}
          unavailable={agenda.unavailable}
          filter={filter}
          // The one thing left is already on the week card.
          onCard={agenda.next !== null}
          onShowAll={() => setPicked("all")}
          rowActions={rowActions}
          onOpen={open}
          sectionRef={sectionRef}
        />
      ),
      calendar: <CalendarRow />,
      reminders: group("reminders"),
      waiting: group("made-by-you"),
      links: group("links"),
    };
    return (
      <View
        ref={bodyView}
        // A direct child of the scroll content, so its y is its offset there.
        onLayout={(event) => {
          bodyTop.current = event.nativeEvent.layout.y;
        }}
        style={styles.body}
      >
        {strip ? (
          <WeekStrip
            days={strip}
            selectedId={stripSelectedId}
            onSelect={selectStripDay}
          />
        ) : null}
        <WeekCard
          summary={summary}
          next={agenda.next}
          nextLabel={agenda.nextLabel}
          filter={filter}
          onFilter={setPicked}
          rowActions={rowActions}
          onOpenNext={open}
        />
        {arrangement.shown.map((key) => (
          <Fragment key={key}>{cards[key]}</Fragment>
        ))}
        {canEdit ? <EditActivityLink onPress={() => setEditing(true)} /> : null}
        {snoozedRows.length > 0 ? (
          <SnoozedPart
            rows={snoozedRows}
            onOpen={open}
            menuFor={rowMenu.wakeMenuFor}
          />
        ) : null}
        {/* What is finished left the page; it is one press away (#5127). */}
        <ArchiveLink onPress={() => setShowArchive(true)} />
      </View>
    );
  }

  return (
    <ActivityFaces.Provider value={faceFor}>
      <ActivityRowMenuContext.Provider value={rowMenu.menuFor}>
        <ScreenShell
          title="Activity"
          refresh={refresh}
          scrollRef={scrollRef}
          headerAction={moduleOn("tasks") ? <TaskBoardLink /> : undefined}
        >
          {renderBody()}
          <ActivitySheet
            row={sheetRow}
            viewerId={viewerId}
            canManage={reviewer.canManage}
            rowActionState={sheetRow ? rowActionStateOf(sheetRow.key) : "idle"}
            onActed={reread}
            onClosed={() => {
              const closedKey = openedKey;
              setOpenedKey(null);
              if (rereadOnClose()) reread();
              // The member may have just done what the card asked: ask again
              // only when the sheet was the card's own item, since every
              // other sheet leaves the card as it was.
              if (nudgeShowsRow(nudge, closedKey)) void nudgeActions.recheck();
            }}
            linkActions={linkActions}
            reminderActions={reminderActions}
          />
          {askDraft !== null ? (
            <AskSheet
              key={askDraft}
              ref={askRef}
              initialDraft={askDraft}
              onClosed={() => setAskDraft(null)}
            />
          ) : null}
          {rowMenu.host}
        </ScreenShell>
        {/* Outside the scroll, as the board's: a link's Undo or a Mark
            done's from a row's menu, the newer one while both run. */}
        {undoShown === "task" ? (
          rowMenu.undoBar
        ) : undo ? (
          <UndoBar key={undo.key} message={undo.message} onUndo={undo.run} />
        ) : null}
      </ActivityRowMenuContext.Provider>
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
  const failed = (title: string, retry: () => void) => (error: unknown) =>
    alertFailure({ title, error, retry });
  function act(
    write: Write,
    message: string,
    takeBack: Write,
    failure: string,
  ): (row: LinkRow) => void {
    // `send` is the write itself; Try again repeats only it. The sheet's
    // close flag is set once, by the press that closes the sheet: a retry
    // from the alert closes nothing, and setting it then would skip the
    // re-read of whatever sheet the member closes next.
    const send = (row: LinkRow) => {
      const undoWrite = () => {
        takeBack
          .mutateAsync(row.link.id)
          .catch(failed("Couldn't undo", undoWrite));
      };
      write.mutateAsync(row.link.id).then(
        () =>
          setUndo((open) => ({
            message,
            // A new key per action, so the bar is announced again.
            key: (open?.key ?? 0) + 1,
            run: () => {
              setUndo(null);
              undoWrite();
            },
          })),
        failed(failure, () => send(row)),
      );
    };
    return (row: LinkRow) => {
      // The sheet closes as this starts; the write re-reads Activity itself
      // when it settles, and a re-read on close would race it.
      skipCloseReread.current = true;
      send(row);
    };
  }

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
  /** For another write that re-reads Activity itself as it settles. */
  const skipNextCloseReread = () => {
    skipCloseReread.current = true;
  };
  return { linkActions, undo, rereadOnClose, skipNextCloseReread };
}

/**
 * A message reminder's writes (#4957). Open goes to the message in chat, in
 * its thread when it is a reply, as Saved opens one. Snooze moves the
 * reminder to a preset and confirms it as the message menu's set does; Done
 * clears it, and the row leaves at once (`useClearMessageReminder`). Either
 * write re-reads Activity as it settles, so the sheet's close doesn't.
 */
function useReminderActions(
  skipNextCloseReread: () => void,
): ReminderSheetActions {
  const router = useRouter();
  const remind = useRemindMessage();
  const clear = useClearMessageReminder();
  const done = (messageId: string) => {
    clear.mutateAsync(messageId).catch((error: unknown) =>
      alertFailure({
        title: "Couldn't clear the reminder",
        error,
        retry: () => done(messageId),
      }),
    );
  };
  return {
    open: ({ reminder }) =>
      router.push({
        pathname: "/chat-thread",
        params: reminder.thread_root_id
          ? {
              channelId: reminder.channel_id,
              threadRootId: reminder.thread_root_id,
              focusMessageId: reminder.message_id,
            }
          : {
              channelId: reminder.channel_id,
              focusMessageId: reminder.message_id,
            },
      }),
    snooze: ({ reminder }, preset) => {
      skipNextCloseReread();
      remind(reminder.message_id, messageReminderPresetTime(preset));
    },
    done: ({ reminder }) => {
      skipNextCloseReread();
      done(reminder.message_id);
    },
  };
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
  sectionRef,
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
  /** Where the week strip finds each day to jump to (#5310). */
  sectionRef: (id: string) => (view: View | null) => void;
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
          viewRef={sectionRef(day.id)}
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
  viewRef,
}: {
  day: ActivityAgendaDay;
  rowActions: ActivityRowActions | null;
  onOpen: (row: ActivityRow) => void;
  viewRef: (view: View | null) => void;
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
    <View ref={viewRef} testID={`activity-day-${day.id}`}>
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
    </View>
  );
}

/**
 * The Calendar row at the foot of To do (#5310, Paul's direction B): the
 * chapter's whole month, optional events included, one press from the list
 * that already runs by day. A place, so its tile wears the Events hue, as
 * an event notice's does, and a chevron says it opens a screen.
 */
function CalendarRow() {
  const router = useRouter();
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const hue = NOTIFICATION_TILE_HUE.events;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Calendar"
      accessibilityHint="Opens the chapter's month."
      onPress={() => router.push("/events")}
      testID="activity-calendar-row"
      style={({ pressed }) => [
        styles.calendarRow,
        pressed ? styles.pressed : null,
      ]}
    >
      <LeadTile hue={hue}>
        <NavGlyph
          paths={NAV_GLYPHS.events}
          color={hue}
          size={LEAD_TILE_GLYPH}
        />
      </LeadTile>
      <Text style={styles.calendarLabel}>Calendar</Text>
      <DisclosureGlyph
        color={tokens.color.text.mutedForeground}
        direction="right"
      />
    </Pressable>
  );
}

/**
 * Edit Activity (#5520), at the foot of the page above Snoozed and the
 * Archive, where Bevel puts Edit Home and Apple Fitness puts Edit Summary.
 * A plain bordered control: the accent stays with the page's one ask.
 */
function EditActivityLink({ onPress }: { onPress: () => void }) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint="Choose which cards Activity shows, and their order."
      onPress={onPress}
      style={({ pressed }) => [styles.editLink, pressed && styles.pressed]}
    >
      <Text style={styles.editLinkText}>Edit Activity</Text>
    </Pressable>
  );
}

/** The door to the Archive, at the foot of the page. */
function ArchiveLink({ onPress }: { onPress: () => void }) {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint="Shows the events, tasks and polls that are over."
      onPress={onPress}
      style={styles.showAll}
    >
      <Text style={[styles.showAllText, { color: accent }]}>Archive</Text>
    </Pressable>
  );
}

/**
 * The Archive (#5127, `spec/behavior/activity.md` § Archive): what the
 * member has finished, in place of the page, which lists only what is still
 * live. Laid out as the page lays out its groups (Events, Tasks, Polls), each
 * row opening what it opens on the page (a task its screen, the rest a
 * sheet), with its item's long-press menu, as web draws it. Google
 * Classroom keeps finished work under its To-do's Done tab the same way.
 */
function ArchiveView({
  query,
  viewerId,
  now,
  onBack,
  onOpen,
  menuFor,
}: {
  query: ReturnType<typeof useActivityArchive>;
  viewerId: string | null;
  now: Date;
  onBack: () => void;
  onOpen: (row: ActivityRow) => void;
  /** A finished task's or event's menu (#5492); nothing there to snooze. */
  menuFor: (row: ActivityRow) => ItemMenuHandle | null;
}) {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens);
  const groups = useMemo(
    () =>
      query.data ? activityArchiveGroups(query.data, viewerId, now) : null,
    [query.data, viewerId, now],
  );
  let content: ReactNode;
  if (query.isPending) {
    content = (
      <SkeletonRegion label="Loading your archive">
        <View>
          <SectionHeader>Events</SectionHeader>
          {Array.from({ length: 3 }, (_, index) => (
            <ActivityRowSkeleton
              key={index}
              index={index}
              isFirst={index === 0}
            />
          ))}
        </View>
      </SkeletonRegion>
    );
  } else if (query.isError && !query.data) {
    content = (
      <ErrorState
        title="Couldn't load your archive"
        body={describeLoadFailure(query.error)}
        onRetry={() => void query.refetch()}
        isRetrying={query.isFetching}
      />
    );
  } else if (groups && groups.length === 0) {
    content = <Text style={styles.archiveEmpty}>{ACTIVITY_ARCHIVE_EMPTY}</Text>;
  } else {
    content = groups?.map((group) => (
      <ArchiveSection
        key={group.id}
        group={group}
        onOpen={onOpen}
        menuFor={menuFor}
      />
    ));
  }
  return (
    <View style={styles.body}>
      <View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to Activity"
          onPress={onBack}
          style={styles.showAll}
        >
          <Text style={[styles.showAllText, { color: accent }]}>
            {"\u2039 Activity"}
          </Text>
        </Pressable>
        <Text accessibilityRole="header" style={styles.archiveTitle}>
          Archive
        </Text>
        <Text style={styles.archiveEmpty}>
          Events, tasks and polls that are over.
        </Text>
      </View>
      {content}
    </View>
  );
}

function ArchiveSection({
  group,
  onOpen,
  menuFor,
}: {
  group: ActivityArchiveGroup;
  onOpen: (row: ActivityRow) => void;
  menuFor: (row: ActivityRow) => ItemMenuHandle | null;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  return (
    <View style={styles.group}>
      <SectionHeader count={group.rows.length || null}>
        {group.label}
      </SectionHeader>
      {group.unavailable ? (
        <InlineNote tone="warning">
          {`Couldn't load ${ACTIVITY_ARCHIVE_SECTION_NAMES[group.id]}. Pull down to try again.`}
        </InlineNote>
      ) : null}
      {group.rows.map((row, index) => (
        <ActivityListRow
          key={row.key}
          row={row}
          isFirst={index === 0}
          onPress={() => onOpen(row)}
          menu={menuFor(row)}
        />
      ))}
    </View>
  );
}

/**
 * Snoozed (#4982, `spec/behavior/activity.md` § Snooze): the rows the member
 * put off, soonest back first, each saying when, behind one control at the
 * foot of the screen, as Gmail keeps Snoozed in its own folder. A row still
 * opens its record; its long press holds Unsnooze, which brings it back now,
 * beside a task's or an event's own actions (#5492).
 */
function SnoozedPart({
  rows,
  onOpen,
  menuFor,
}: {
  rows: ActivityRow[];
  onOpen: (row: ActivityRow) => void;
  menuFor: (row: ActivityRow) => ItemMenuHandle | null;
}) {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens);
  const [open, setOpen] = useState(false);
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((shown) => !shown)}
        style={styles.showAll}
      >
        <Text style={[styles.showAllText, { color: accent }]}>
          {open ? "Hide snoozed" : `Snoozed (${rows.length})`}
        </Text>
      </Pressable>
      {open
        ? rows.map((row, index) => (
            <ActivityListRow
              key={row.key}
              row={row}
              isFirst={index === 0}
              onPress={() => onOpen(row)}
              menu={menuFor(row)}
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
    calendarRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
      minHeight: tokens.touch.minimum,
    },
    calendarLabel: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
      flex: 1,
    },
    archiveTitle: {
      ...typeRole(tokens.typography.role.title),
      color: tokens.color.text.foreground,
    },
    archiveEmpty: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
    },
    editLink: {
      minHeight: tokens.touch.minimum,
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tokens.color.border.input,
      alignItems: "center",
      justifyContent: "center",
    },
    editLinkText: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    showAllText: {
      ...typeRole({
        ...tokens.typography.role.label,
        weight: tokens.typography.weight.semibold,
      }),
    },
  });
}
