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
  activityWeekSummary,
  activityRowTaskId,
  findActivityTaskRow,
  useActivity,
  useEventsOnNow,
  nowCardEventIds,
  withoutEvents,
  useActivityArchive,
  useActivitySnoozeWake,
  useActivityUnread,
  useNowDate,
  useCurrentChapter,
  useActivityNudge,
  useActivityNudgeActions,
  useMyPermissions,
  useSetActivityNudgesEnabled,
  type ActivityNudge,
  useViewerUserId,
  useActivityFaces,
  useClearMessageReminder,
  type ActivityAgendaDay,
  type ActivityAgendaFilter,
  type ActivityArchiveGroup,
  type ActivityGroup,
  type ActivityPart,
  type ActivityReview,
  type ActivityRow,
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
  type ReminderSheetActions,
} from "@/components/activity/activity-sheet";
import { ActivityEditor } from "@/components/activity/activity-editor";
import { NudgeCard } from "@/components/activity/nudge-card";
import {
  activityNudgeAskPrompt,
  nudgeShowsRow,
  withoutNowEvents,
} from "@/lib/activity/nudge";
import { ReviewCard } from "@/components/activity/review-card";
import { WeekRing, WeekRingSkeleton } from "@/components/activity/week-ring";
import { NowCard } from "@/components/now-card";
import { DisclosureGlyph } from "@/components/control-glyphs";
import { AskSheet } from "@/components/ask/ask-sheet";
import { InlineNote } from "@/components/inline-note";
import { SectionCount, SectionHeader } from "@/components/list-section";
import { useRefetchAll } from "@/components/pull-to-refresh";
import { ScreenShell } from "@/components/screen-shell";
import { ErrorState, SkeletonRegion } from "@/components/state-block";
import { activityRowActionsAllowed } from "@/lib/activity/row-action";
import { useActivityReread } from "@/lib/activity/use-activity-reread";
import { useAiSurfaces } from "@/lib/ai/availability";
import { useChapterBranding } from "@/lib/chapter-branding";
import { useRemindMessage } from "@/lib/chat/message-reminder";
import { alertFailure } from "@/lib/failure-alert";
import { pageSurfaces } from "@/lib/surfaces";
import { typeRole, useFrappTheme } from "@/lib/theme";
import type { ActivityCardKey } from "@repo/validation";

/**
 * Activity: what the member still has to do, and what they have running
 * (#3897, `spec/behavior/activity.md`). An inbox beside chat, not a home.
 * Tab 2 since 2026-11-12 (#4610), whose icon carries the count of what needs
 * the member; the task board's door and the week ring are on the title row.
 *
 * Cut to one home per question on 2026-11-20 (#5779, Paul's direction A):
 * the week strip, the week card, This semester, Last week, Links and the
 * Calendar card left. Top to bottom:
 *
 * 0. Now (`NowCard`, #5777): the event on right now. Always first.
 * 1. The cards the member arranges (`ActivityCardKey`): the Frapp card
 *    (`NudgeCard`), To do and Running.
 *    - To do: the member's own events, tasks, polls, sign-ups and due
 *      reminders by day (`activityAgenda`), three to a day before "Show
 *      more". Its header holds the Calendar link (the chapter's month).
 *    - Running: "N to approve" (`ReviewCard`) for an officer with something
 *      to sign off, then the tasks they assigned, the events they made and
 *      the polls they posted.
 * 2. Edit Activity, Snoozed and the Archive at the foot.
 *
 * The week ring on the title row (`WeekRing`) is done of total this week;
 * pressed, it opens a line per kind, and a line narrows To do to its kind.
 * This semester and Last week are on You, beside Points; a channel's
 * sign-up links are in its own menu.
 *
 * It is drawn and checked for four people (`principles.md` § Three people):
 * a member with nothing due, an average member, a committee chair and the
 * president. Web's `/activity` is the same page from the same model
 * (`apps/web/components/activity/activity-page.tsx`).
 *
 * A task row pushes the task's own screen (#5492), a task for everyone the
 * copy that carries its group, and a completion waiting on the member's
 * sign-off too, where they confirm it or send it back (#5513); any other row
 * opens the record in a sheet drawn with chat's own card, where the member
 * acts on it (`components/activity/activity-sheet.tsx`). A long press on a task or event row opens the
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
  // stay current while the page is open.
  const now = useNowDate();
  const viewerId = useViewerUserId();
  // Faces on the rows (#4402, item 4), from the roster chat already reads.
  const faceFor = useActivityFaces();
  // Also on every return to this screen: it stays mounted under the thread
  // or event details it pushes, and a vote cast there is not heard here.
  // You draws the standing and reads it again whenever it comes back into
  // view, so a check-in here needn't read it.
  const reread = useActivityReread();
  const chapterRead = useCurrentChapter();
  const chapter = chapterRead.data;
  const chapterModules = chapter?.enabled_modules;
  const moduleOn = useCallback(
    (key: string) => isModuleEnabled(chapterModules, key),
    [chapterModules],
  );
  const [openedKey, setOpenedKey] = useState<string | null>(null);
  const router = useRouter();
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
  // A reminder's Snooze or Done re-reads Activity itself as it settles, so
  // the sheet's close, which it causes, doesn't read it a second time.
  const skipCloseReread = useRef(false);
  const reminderActions = useReminderActions(() => {
    skipCloseReread.current = true;
  });
  const rereadOnClose = () => {
    const skip = skipCloseReread.current;
    skipCloseReread.current = false;
    return !skip;
  };

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
  const refreshPage = useRefetchAll([activity, layout]);
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
  // time (#4982). The week ring counts from the whole read: snoozing
  // something doesn't finish it.
  // The event the Now card shows is at the top (#5777), so To do and the
  // Frapp card leave it out rather than say it twice. One under "+N more on
  // now" keeps its row, since the card doesn't open it.
  const { events: onNow } = useEventsOnNow();
  const visible = useMemo(
    () =>
      activity.data
        ? withoutEvents(
            activityAwake(activity.data, now),
            nowCardEventIds(onNow),
          )
        : undefined,
    [activity.data, now, onNow],
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
  // What the member assigned, made and posted, under Running, as the shared
  // group builds it. Narrowed to a kind, the page is the To do list alone. A
  // task for everyone the member assigned is one row (#5492).
  const running = useMemo(() => {
    const group = visible ? (activityGroups(visible, now)[0] ?? null) : null;
    return group && (group.rows.length > 0 || group.unavailable.length > 0)
      ? group
      : null;
  }, [visible, now]);
  // The open row as the latest read has it. A row that has left the list (a
  // vote cast, a completion confirmed) is `null` here and the sheet keeps
  // drawing the one it was opened with, so the member sees the result of
  // what they just did.
  const openRow = useMemo(() => {
    if (openedKey === null) return null;
    const row = [
      ...(agenda?.rows ?? []),
      ...(review?.rows ?? []),
      ...(running?.rows ?? []),
      ...snoozedRows,
    ].find((candidate) => candidate.key === openedKey);
    return row ?? null;
  }, [agenda, review, running, snoozedRows, openedKey]);
  const [opened, setOpened] = useState<ActivityRow | null>(null);
  const sheetRow = openedKey === null ? null : (openRow ?? opened);

  // The card at the top (#5464): the one most useful thing waiting on the
  // member, and a tray of the next few, picked by the server from Activity's
  // own reads. It shows with or without AI; AI only adds a sentence, so it is
  // asked for on every Activity. Any failure is no card. It is asked again
  // after acting on what it opened: when its sheet closes, when the member comes back from the task screen they pushed, and
  // after a write from a row's menu.
  // A hidden card isn't asked for: the read can cost a model call.
  // It waits for the arrangement, so a member who hid it never sends one.
  const nudgeRead = useActivityNudge({
    enabled: !layout.isPending && shows("nudge"),
  });
  // Never the Now card's event a second time: when the card's pick is it,
  // the tray's first takes its place.
  const nudge = useMemo(
    () => withoutNowEvents(nudgeRead.data, nowCardEventIds(onNow)),
    [nudgeRead.data, onNow],
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
  // Dots (#4405): opening a row from here is what reads it; scrolling past
  // doesn't, and neither does acting on the item elsewhere in Frapp.
  const { markRead } = useActivityUnread(activity.data);
  const open = (row: ActivityRow) => {
    if (row.unread && row.readRef) markRead([row.readRef]);
    // A task is its own screen (#5492; Paul, 2026-11-18: the sheet was
    // "lazy"), as on the board and the Calendar; a task for everyone opens
    // the copy that carries its group. A completion waiting on the viewer's
    // sign-off too: the screen holds Confirm and Send back (#5513).
    const taskId = activityRowTaskId(row);
    if (taskId !== null) {
      // What the card opened is asked again on the way back, as a sheet's
      // close asks it.
      if (nudgeShowsRow(nudge, row.key)) {
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
  // its row opens it, its screen with Confirm and Send back (#5513), and the
  // param is dropped so coming back to the tab doesn't open it again. A task
  // the read lists no row for (a copy of a task for everyone, whose row
  // names only the copy it opens, #5492; or one past the read's cap) pushes
  // its screen by id all the same; one deleted since says so there.
  const { review: reviewParam } = useLocalSearchParams<{ review?: string }>();
  const reviewTaskId =
    typeof reviewParam === "string" && reviewParam !== "" ? reviewParam : null;
  const refetchActivity = activity.refetch;
  useEffect(() => {
    if (reviewTaskId === null) return;
    let live = true;
    void (async () => {
      const result = await refetchActivity();
      if (!live) return;
      const row = result.data
        ? findActivityTaskRow(result.data, reviewTaskId, new Date())
        : null;
      // Dropped first: opening may push a screen, whose params these
      // would then be.
      router.setParams({ review: undefined });
      if (row) open(row);
      else {
        router.push({
          pathname: "/task-details",
          params: { id: reviewTaskId },
        });
      }
    })();
    return () => {
      live = false;
    };
    // Once per review linked; `open` is read when the read lands.
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
            ? findActivityTaskRow(activity.data, id, new Date())
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
            ? findActivityTaskRow(activity.data, id, new Date())
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
    // Now has its own read (#5777): a meeting on stays at the top while the
    // page's read loads or fails.
    if (activity.isPending) {
      return (
        <>
          <NowCard />
          <SkeletonRegion label="Loading activity" flush>
            <View style={styles.body}>
              <View>
                {/* The month needs none of this read, so its door is never
                    gone. */}
                <ToDoHeader count={null} />
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
        </>
      );
    }
    // Only with nothing to show: a re-read that fails (this screen re-reads
    // after every action) keeps the page it already has.
    if (activity.isError && !activity.data) {
      return (
        <>
          <NowCard />
          <ErrorState
            title="Couldn't load your activity"
            body={describeLoadFailure(activity.error)}
            onRetry={() => void activity.refetch()}
            isRetrying={activity.isFetching}
          />
          <CalendarLink />
        </>
      );
    }
    if (!agenda) return <CalendarLink />;
    // Each card the member may move or hide, drawn where their arrangement
    // puts it. A card with nothing in it is null, as before: no empty card.
    // Narrowed to a kind by the week ring, the page is the To do list, so
    // Running steps out.
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
      todo: (
        <ToDoSection
          days={agenda.days}
          unavailable={agenda.unavailable}
          filter={filter}
          onShowAll={() => setPicked("all")}
          rowActions={rowActions}
          onOpen={open}
        />
      ),
      running:
        filter === "all" && (review || running) ? (
          <RunningSection
            review={review}
            group={running}
            rowActions={rowActions}
            onOpen={open}
          />
        ) : null,
    };
    return (
      <View style={styles.body}>
        <NowCard />
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

  // The week ring and the task board's door share the title row. Neither
  // shows over the Archive or the editor, which the ring doesn't narrow.
  const onPage = !editing && !showArchive;
  const ring =
    !onPage ? null : summary ? (
      <WeekRing summary={summary} filter={filter} onFilter={setPicked} />
    ) : activity.isPending ? (
      <WeekRingSkeleton />
    ) : null;
  const board = moduleOn("tasks") ? <TaskBoardLink /> : null;

  return (
    <ActivityFaces.Provider value={faceFor}>
      <ActivityRowMenuContext.Provider value={rowMenu.menuFor}>
        <ScreenShell
          title="Activity"
          refresh={refresh}
          headerAction={
            ring || board ? (
              <View style={styles.headerActions}>
                {ring}
                {board}
              </View>
            ) : undefined
          }
        >
          {renderBody()}
          <ActivitySheet
            row={sheetRow}
            viewerId={viewerId}
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
        {/* Outside the scroll, as the board's: a Mark done's from a row's
            menu. */}
        {rowMenu.undoBar}
      </ActivityRowMenuContext.Provider>
    </ActivityFaces.Provider>
  );
}

/**
 * The task board's door (#4610): the board (List and Grid, the points line)
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
 * is open for check-in now, then each day; due reminders sit on their day
 * (#5779). What waits on the member's review is never here (Running).
 */
function ToDoSection({
  days,
  unavailable,
  filter,
  onShowAll,
  rowActions,
  onOpen,
}: {
  days: ActivityAgendaDay[];
  unavailable: ActivityGroup["unavailable"];
  filter: ActivityAgendaFilter;
  onShowAll: () => void;
  /** Check in on an open event's row (#4427); `null` while refused. */
  rowActions: ActivityRowActions | null;
  onOpen: (row: ActivityRow) => void;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const count = days.reduce((sum, day) => sum + day.rows.length, 0);
  return (
    <View style={styles.group}>
      <ToDoHeader count={count || null} />
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
 * To do's heading, with the Calendar link at its end (#5779): the chapter's
 * whole month, optional events included, one press from the list that
 * already runs by day, where the Calendar card was (#5310). Apple Reminders
 * and Things keep a list's other views in its header the same way.
 */
function ToDoHeader({ count }: { count: number | null }) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  return (
    <View style={styles.headerRow}>
      <View style={styles.headerLabel}>
        <SectionHeader count={count}>To do</SectionHeader>
      </View>
      <CalendarLink />
    </View>
  );
}

/** "Calendar ›": the chapter's month, a pushed screen since #5310. */
function CalendarLink() {
  const router = useRouter();
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Calendar"
      accessibilityHint="Opens the chapter's month."
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      onPress={() => router.push("/events")}
      testID="activity-calendar-link"
      style={({ pressed }) => [
        styles.calendarLink,
        pressed ? styles.pressed : null,
      ]}
    >
      <Text style={[styles.showAllText, { color: accent }]}>Calendar</Text>
      <DisclosureGlyph color={accent} direction="right" />
    </Pressable>
  );
}

/**
 * "Running" (#5779): what the member has going, where To review and Waiting
 * on others were. "N to approve" leads (`ReviewCard`), for an officer with
 * something to sign off; then the tasks they assigned with their progress,
 * the events they made with their headcount, and the polls they posted. The
 * screen leaves it out when it has nothing, so there is no empty heading.
 * Linear's "My issues" splits Assigned from Created the same way.
 */
function RunningSection({
  review,
  group,
  rowActions,
  onOpen,
}: {
  review: ActivityReview | null;
  group: ActivityGroup | null;
  rowActions: ActivityRowActions | null;
  onOpen: (row: ActivityRow) => void;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const count = (review?.rows.length ?? 0) + (group?.rows.length ?? 0);
  return (
    <View style={styles.group}>
      <SectionHeader count={count || null}>Running</SectionHeader>
      {review ? (
        <ReviewCard review={review} rowActions={rowActions} onOpen={onOpen} />
      ) : null}
      {group && group.unavailable.length > 0 ? (
        // A section the read could not load is said, never shown as empty.
        <InlineNote tone="warning">
          {`${activityCouldNotLoad(group.unavailable)} Pull down to try again.`}
        </InlineNote>
      ) : null}
      {group?.parts.map((part) => (
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
 * Edit Activity (#5520), at the foot of the page above Snoozed and the
 * Archive, where Bevel puts Edit Home and Apple Fitness puts Edit Summary.
 * A plain bordered control sized to its words (no full-width buttons,
 * #5708): the accent stays with the page's one ask.
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
      <SkeletonRegion label="Loading your archive" flush>
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
 * One run of Running's rows (#4173): the tasks the member assigned, the
 * events they made, or the polls they posted. A long part draws its first few rows and a "Show all" for
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
    headerActions: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
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
    headerRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
    },
    headerLabel: { flex: 1, minWidth: 0 },
    calendarLink: {
      flexDirection: "row",
      alignItems: "center",
      gap: 2,
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
      alignSelf: "flex-start",
      paddingHorizontal: tokens.spacing.lg,
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
