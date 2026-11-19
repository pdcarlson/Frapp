import { describeLoadFailure, errorCopy } from "@repo/hooks/error-copy";
import { statusOf } from "@repo/api-sdk";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Alert,
  Keyboard,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  TASK_ACTION_LABELS,
  taskStatusLabel,
  useDeleteTask,
  useMemberDisplayNames,
  usePermissionList,
  useReleaseTask,
  useRemoveFromTaskGroup,
  useTask,
  useTasks,
  useViewerUserId,
} from "@repo/hooks";
import { can, TASK_AUDIENCE_COPY } from "@repo/validation";
import { SignetTokens } from "@repo/theme/signet";
import { ScreenShell } from "@/components/screen-shell";
import { BACK_TO_TASKS } from "@/components/back-row";
import { ErrorState } from "@/components/state-block";
import { InlineNote } from "@/components/inline-note";
import { StatusChip } from "@/components/status-chip";
import { HistoryRow } from "@/components/history-row";
import { eyebrowStyle } from "@/components/eyebrow";
import {
  CheckGlyph,
  CloseGlyph,
  MinusGlyph,
  MoreGlyph,
  PencilGlyph,
  UndoGlyph,
} from "@/components/control-glyphs";
import { SubtaskChecklist } from "@/components/tasks/subtask-checklist";
import { TaskProof } from "@/components/tasks/task-photos";
import { TaskEditForm } from "@/components/tasks/task-edit-form";
import { UndoBar } from "@/components/tasks/undo-bar";
import {
  TaskActionBar,
  TaskActionBarSpacer,
  TaskBarIcon,
  TaskBarPill,
} from "@/components/tasks/task-action-bar";
import { WhoHasIt } from "@/components/tasks/who-has-it";
import { GroupProgress } from "@/components/tasks/group-progress";
import { OpenTaskScreen } from "@/components/tasks/open-task-screen";
import {
  createTaskFactStyles,
  TaskDetailSkeleton,
  TaskFact,
  TaskMinutesFact,
  TaskFacts,
  TaskRepeatFact,
} from "@/components/tasks/task-facts";
import { useChapterBranding } from "@/lib/chapter-branding";
import { useDropKeptSheetDraft } from "@/lib/kept-sheet-draft";
import { showActionMenu } from "@/lib/action-menu";
import { goBackTo } from "@/lib/href";
import { leaveScreen } from "@/lib/back-target";
import { rowIsSentBack, toTaskRow, type TaskRowModel } from "@/lib/tasks/board";
import { formatDueDate, formatPointsChip } from "@/lib/tasks/format";
import { taskStatusHue } from "@/lib/tasks/status-hue";
import { taskEditDraftName, useTaskEdit } from "@/lib/tasks/use-task-edit";
import {
  confirmBarLabel,
  confirmTaskDelete,
  groupCopies,
  livePicks,
  markDoneBarLabel,
  removalAllowed,
  removeConfirmTitle,
  REMOVE_CONFIRM_BODY,
  REMOVE_EVERYONE_NOTE,
  removedLine,
  rowGroupLabel,
  removeLabel,
  rowStatus,
  sortCopies,
  taskBarLayout,
  taskHistory,
  taskScreenControls,
} from "@/lib/tasks/task-screen";
import { useStartTask } from "@/lib/tasks/use-start-task";
import { useMemberLabel } from "@/lib/tasks/use-member-label";
import { MarkDoneHost, useTaskToggle } from "@/lib/tasks/use-task-toggle";
import { useTaskReview } from "@/lib/tasks/use-task-review";
import {
  RELEASE_FAILED,
  RELEASED_LINE,
  RELEASED_PARAM,
} from "@/lib/tasks/open-tasks";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * One task as its own pushed screen (#5492), where the task detail sheet used
 * to rise (Paul, 2026-11-18: "I'm not a super fan of the sheet that pops up
 * when you do tap on a task. I think that's lazy"). Built like Event details:
 * `ScreenShell`, the task's title, and the task's parts top to bottom, as
 * Linear's issue page lays out a pushed issue.
 *
 * Reached from a row on the task board, from the Calendar's task rows, and
 * from a task push through the board (`/tasks?task=<id>`), with an `id`. A
 * task up for grabs opens here too, with `posting=<id>` in place of the `id`,
 * and draws its own screen (`OpenTaskScreen`, #5570).
 *
 * ## What it shows
 *
 * The status as a colour chip in the shared words (`taskStatusLabel`); a row
 * of three facts, Due, Points and From, as Linear's issue header lists them,
 * and on a group's copy who it went to with its meter;
 * the description; the checklist; the photos and proof; for an officer on a
 * task sent to everyone, Who has it (each member's copy, "3 of 12 done");
 * then History, read off the task's own timestamps, as Todoist's task page
 * lists its activity. A part with nothing in it draws nothing: a one-line
 * task is a short screen, and a task with everything is a long one.
 *
 * ## Its controls, at the bottom
 *
 * A floating glass bar under the thumb, as Things 3 keeps a to-do's controls
 * (`TaskActionBar`). Mark done is the one thing to do and the only control in
 * the chapter accent, a pill with its verb; Edit, Remove people and More are
 * 44pt rounds. More opens the system menu: Mark not done, Give it back, Delete
 * and, on a group task, Delete for everyone. Each shows only to a viewer the
 * API lets use it (`taskScreenControls`).
 *
 * ## Edit, in place
 *
 * The pencil turns the screen into its own editor (#5514; Paul's rule, no
 * pop-up sheets), as Apple Reminders and Things 3 edit a to-do where it is:
 * the facts and the description become the title, due day and time, points
 * and notes fields, with what Mark done needs, the photos and who it is for
 * under them (`TaskEditForm`). Each field saves itself as it is left, through
 * `PATCH /v1/tasks/:id` as web's task panel saves, and on a group task's copy
 * with `scope: "group"`, so every copy not yet confirmed changes
 * (`useTaskEdit`); Who hands over that one copy. The bar becomes one accent
 * Done, which saves what is still being typed, waits on every save on its
 * way, and puts the screen back. What doesn't save as the screen goes is
 * kept for the task's next edit (`task-edit:<id>`). A row's long-press
 * Edit, and chat's task card's, push this screen with `edit=1`, and
 * Reassign with `who=1`, which opens Assign to's picker over it.
 *
 * ## Confirm and Send back
 *
 * On a member's completion waiting on the viewer's sign-off (#5513), Confirm
 * is the accent pill with its payout ("Confirm · +10 pts"), Send back a round
 * beside it and Edit moves into More, as web's review keeps Edit under its ⋯
 * (`taskBarLayout`). Send back also shows wherever chat's card offers it (a
 * completion that needed no sign-off), with no pill. Both are chat's task
 * card's (`useTaskReview`): Send back opens the card's sheet for the reason
 * and "Ask for a photo next time". The officer stays on the screen, which
 * redraws Confirmed or Needs changes in place, as Activity's review sheet
 * stayed on the card; Activity re-reads when they go back to it. The proof is
 * on the screen above, so it is seen before either.
 *
 * ## Remove people
 *
 * The minus turns Who has it into a select mode on this screen, as Apple
 * Mail's Edit puts a circle on each message: a confirmed copy is dimmed and
 * can't be picked, and the bar becomes one red Remove pill and a Cancel. It
 * asks first in the platform alert, since the copies are deleted and can't be
 * brought back, then `POST /v1/tasks/:id/group/remove`. A row's long-press
 * Remove people (#5492) pushes this screen with `select=1`, and it opens in
 * select mode.
 */
export default function TaskDetailsRoute() {
  // `posting=<id>`: a task up for grabs (#5570), which is a posting and not
  // yet a task, so it reads off its own list and has its own controls.
  const { posting } = useLocalSearchParams<{ posting?: string | string[] }>();
  const postingId = Array.isArray(posting) ? posting[0] : posting;
  return postingId ? (
    <OpenTaskScreen postingId={postingId} />
  ) : (
    <TaskDetailsScreen />
  );
}

function TaskDetailsScreen() {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const params = useLocalSearchParams<{
    id?: string | string[];
    select?: string | string[];
    edit?: string | string[];
    who?: string | string[];
  }>();
  const taskId = Array.isArray(params.id) ? params.id[0] : (params.id ?? "");
  const flag = (value: string | string[] | undefined) =>
    (Array.isArray(value) ? value[0] : value) === "1";
  // `select=1`: a row's long-press Remove people (#5492). `edit=1`: its
  // Edit, or chat's task card's; `who=1`: its Reassign (#5514).
  const startSelecting = flag(params.select);
  const arrival = flag(params.who) ? "who" : flag(params.edit) ? "edit" : null;

  const taskQuery = useTask(taskId);
  const row = useMemo(
    () =>
      taskQuery.data && typeof taskQuery.data === "object"
        ? toTaskRow(taskQuery.data as Record<string, unknown>)
        : null,
    [taskQuery.data],
  );

  // An edit left unsaved past this screen (#4872) goes with its task: one
  // deleted since has no screen to edit it on.
  const taskGone =
    !taskQuery.isPending &&
    taskQuery.isError &&
    statusOf(taskQuery.error) === 404;
  useDropKeptSheetDraft(taskId ? taskEditDraftName(taskId) : null, taskGone);

  if (!taskId) {
    return (
      <ScreenShell back={BACK_TO_TASKS} title="Task">
        <InlineNote>Open a task from Tasks.</InlineNote>
      </ScreenShell>
    );
  }

  if (taskQuery.isPending) {
    return (
      <ScreenShell back={BACK_TO_TASKS} title="Task">
        <TaskDetailSkeleton />
      </ScreenShell>
    );
  }

  if (!row) {
    return (
      <ScreenShell back={BACK_TO_TASKS} title="Task">
        <ErrorState
          title="Couldn't load this task"
          body={describeLoadFailure(taskQuery.error)}
          onRetry={() => void taskQuery.refetch()}
          isRetrying={taskQuery.isFetching}
        />
      </ScreenShell>
    );
  }

  return (
    <TaskScreen
      row={row}
      styles={styles}
      startSelecting={startSelecting}
      arrival={arrival}
    />
  );
}

function TaskScreen({
  row,
  styles,
  startSelecting: selectOnArrival,
  arrival,
}: {
  row: TaskRowModel;
  styles: ReturnType<typeof createStyles>;
  /** Open in Remove people's select mode, once Who has it can show. */
  startSelecting: boolean;
  /** Open in edit mode (`edit`), or there on Assign to (`who`). */
  arrival: "edit" | "who" | null;
}) {
  const { tokens } = useFrappTheme();
  const factStyles = createTaskFactStyles(tokens);
  const { accent } = useChapterBranding();
  const router = useRouter();
  const viewerId = useViewerUserId();
  const canManage = can("tasks:manage", usePermissionList());
  const roster = useMemberDisplayNames();
  const { avatarFor, avatarTintFor } = roster;
  const nameOf = useMemberLabel();
  // In a sentence ("Assigned by you"), the viewer is "you".
  const nameInLine = useCallback(
    (userId: string) => (userId === viewerId ? "you" : nameOf(userId)),
    [nameOf, viewerId],
  );

  // Mark done and Mark not done, shared with the board's checkbox.
  const findRow = useCallback(
    (id: string | null) => (id === row.id ? row : null),
    [row],
  );
  const toggles = useTaskToggle(findRow, { viewerId });
  // More's Start (#5492): what chat's task card offered on a To do.
  const startTask = useStartTask();
  // An officer's Confirm and Send back (#5513), chat's task card's.
  const review = useTaskReview();
  const controls = taskScreenControls({
    row,
    viewerId,
    canManage,
    toggleRefused: toggles.refusal !== null || review.refusal?.gate === true,
  });

  // Who has it reads the group's copies off the board's query, which holds
  // the chapter's every task for an officer (`groupCopies`).
  const tasksQuery = useTasks();
  const copies = useMemo(
    () =>
      canManage
        ? sortCopies(groupCopies(tasksQuery.data, row.groupId), nameOf)
        : [],
    [canManage, tasksQuery.data, row.groupId, nameOf],
  );
  const showPeople = canManage && row.groupId !== null && copies.length > 0;

  // Remove people's select mode, on this screen rather than a sheet.
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [peopleNote, setPeopleNote] = useState<string | null>(null);
  const removal = removalAllowed(picked, copies);
  const removeFromGroup = useRemoveFromTaskGroup();

  // Back where the member came from (the board, the Calendar), or to the
  // board on a cold link with nothing under this screen.
  const leave = () => leaveScreen(router, BACK_TO_TASKS.href);
  const startSelecting = () => {
    setPeopleNote(null);
    setPicked(new Set());
    setSelecting(true);
  };
  const stopSelecting = () => {
    setSelecting(false);
    setPicked(new Set());
  };
  // Arrived from a row's Remove people: select mode as soon as the copies
  // are read, once, and the param cleared so a return here doesn't reopen it.
  const arrivedSelecting = useRef(false);
  const canStartSelecting = controls.removePeople && showPeople;
  useEffect(() => {
    if (!selectOnArrival || arrivedSelecting.current || !canStartSelecting) {
      return;
    }
    arrivedSelecting.current = true;
    setPeopleNote(null);
    setPicked(new Set());
    setSelecting(true);
    router.setParams({ select: undefined });
  }, [selectOnArrival, canStartSelecting, router]);
  const pick = (userId: string) =>
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  const runRemove = async (assigneeIds: string[]) => {
    try {
      const result = await removeFromGroup.mutateAsync({
        id: row.id,
        assigneeIds,
      });
      stopSelecting();
      const line = removedLine(result.removed.length);
      setPeopleNote(line);
      AccessibilityInfo.announceForAccessibility(line);
      // The copy on screen was one of them: there is nothing left to show.
      if (row.assigneeId && result.removed.includes(row.assigneeId)) leave();
    } catch (error) {
      setPeopleNote(
        errorCopy(error, "Couldn't take them out. Try again.", {
          serverWritesForMembers: true,
        }),
      );
    }
  };
  const confirmRemove = () => {
    // Only picks still among the copies: one that left on a refetch isn't sent.
    const assigneeIds = [...livePicks(picked, copies)];
    // The platform alert, as other deletes ask: the copies can't come back,
    // so there is no undo to offer instead.
    Alert.alert(removeConfirmTitle(assigneeIds.length), REMOVE_CONFIRM_BODY, [
      { text: "Cancel", style: "cancel" },
      {
        text: removeLabel(assigneeIds.length),
        style: "destructive",
        onPress: () => void runRemove(assigneeIds),
      },
    ]);
  };

  // Edit, in place (#5514): the pencil turns the screen into its editor,
  // and Done puts it back once what is still typed has saved. Only while
  // the viewer may edit: a confirm landing meanwhile ends it.
  const edit = useTaskEdit(row);
  const { begin: beginEdit, discard: discardEdit, commitAll } = edit;
  const [editMode, setEditMode] = useState(false);
  const editing = editMode && controls.edit;
  const [finishing, setFinishing] = useState(false);
  const [whoOnArrival, setWhoOnArrival] = useState(false);
  const startEdit = useCallback(() => {
    setSelecting(false);
    setPicked(new Set());
    beginEdit();
    setEditMode(true);
  }, [beginEdit]);
  // Confirmed meanwhile (here, on web, by another officer): edit mode ends,
  // and what was still typed goes with it, since the API would refuse it.
  const canEdit = controls.edit;
  useEffect(() => {
    if (!editMode || canEdit) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the task's read moved under the screen (confirmed elsewhere); edit mode follows it
    setEditMode(false);
    discardEdit();
  }, [editMode, canEdit, discardEdit]);
  const finishEdit = async () => {
    if (finishing) return;
    Keyboard.dismiss();
    setFinishing(true);
    const saved = await commitAll();
    setFinishing(false);
    // A field that didn't save keeps its draft and says why.
    if (saved) setEditMode(false);
  };
  // Arrived from a row's Edit or Reassign, or chat's card: edit mode once,
  // and the params cleared so a return here doesn't reopen it. A task the
  // viewer can't edit clears them too, and opens as it reads.
  const arrivedEditing = useRef(false);
  useEffect(() => {
    if (!arrival || arrivedEditing.current) return;
    arrivedEditing.current = true;
    router.setParams({ edit: undefined, who: undefined });
    if (!canEdit) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a one-shot route param, cleared above, opens edit mode once
    startEdit();
    setWhoOnArrival(arrival === "who");
  }, [arrival, canEdit, startEdit, router]);
  // What an edit's last save said outlasts edit mode, until the next thing
  // the member does here.
  const { dismiss: dismissEdit } = edit;
  const afterEdit =
    <A extends unknown[]>(run: (...args: A) => void) =>
    (...args: A) => {
      dismissEdit();
      run(...args);
    };

  // Delete, after the platform alert, then back to the board.
  const deleteTask = useDeleteTask();
  const [deleteFailed, setDeleteFailed] = useState<string | null>(null);
  const runDelete = async (everyone: boolean, series?: "series") => {
    setDeleteFailed(null);
    try {
      await deleteTask.mutateAsync(
        everyone
          ? { id: row.id, scope: "group" }
          : series
            ? { id: row.id, scope: series }
            : row.id,
      );
      leave();
    } catch (error) {
      setDeleteFailed(errorCopy(error, "Couldn't delete the task. Try again."));
    }
  };
  const confirmDelete = (everyone: boolean) =>
    confirmTaskDelete(
      row,
      everyone,
      (series) => void runDelete(everyone, series),
    );

  // Give it back (tasks.md § Up for grabs): the task is deleted and its
  // posting is open again, so there is nothing left here to show. It lands on
  // the board, where the posting is back under Up for grabs and the board
  // says so in its line (`released=1`); from the Calendar that is a step
  // sideways, which is the point: the task is no longer the member's.
  const releaseTask = useReleaseTask();
  const runRelease = () => {
    setDeleteFailed(null);
    releaseTask.mutate(row.id, {
      onSuccess: () => {
        AccessibilityInfo.announceForAccessibility(RELEASED_LINE);
        goBackTo(router, {
          pathname: "/tasks",
          params: { [RELEASED_PARAM]: "1" },
        });
      },
      onError: (error) =>
        setDeleteFailed(
          errorCopy(error, RELEASE_FAILED, { serverWritesForMembers: true }),
        ),
    });
  };

  // More's rows, in order, the destructive ones last. No Copy link: the web
  // has no page for one task to link to yet, and a `frapp://` link reads as
  // dead text in chat.
  const restOfMore = [
    ...(controls.start && toggles.canToggle(row)
      ? [
          {
            label: TASK_ACTION_LABELS.start,
            onPress: () => startTask(row.id),
          },
        ]
      : []),
    ...(controls.reopen
      ? [
          {
            label: TASK_ACTION_LABELS.reopen,
            onPress: () => void toggles.toggle(row),
          },
        ]
      : []),
    ...(controls.release
      ? [
          {
            label: TASK_AUDIENCE_COPY.release,
            onPress: runRelease,
          },
        ]
      : []),
    ...(controls.delete
      ? [
          {
            label: "Delete",
            style: "destructive" as const,
            onPress: () => confirmDelete(false),
          },
        ]
      : []),
    ...(controls.deleteForEveryone
      ? [
          {
            label: "Delete for everyone",
            style: "destructive" as const,
            onPress: () => confirmDelete(true),
          },
        ]
      : []),
  ];
  const showRemovePeople = controls.removePeople && showPeople;
  // Send back a round while the bar has room, else More's first row; Edit in
  // More while Confirm shows, so the pill keeps its payout (#5513).
  const {
    sendBackRound,
    sendBackInMore,
    editRound,
    editInMore,
    moreShown: showMore,
    rounds,
  } = taskBarLayout({
    // Copied out as plain booleans: handing `controls` itself on makes the
    // React Compiler treat it, and `canManage` behind it, as mutable, and
    // skip this component (`react-hooks/preserve-manual-memoization`).
    controls: {
      confirm: controls.confirm === true,
      sendBack: controls.sendBack === true,
      edit: controls.edit === true,
    },
    removePeople: showRemovePeople,
    otherMoreRows: restOfMore.length,
  });
  const moreRows = [
    // Held as the round is (offline, mid-write, refused): the system menu
    // has no disabled row, so it is left out until it can send.
    ...(sendBackInMore && !review.disabled
      ? [
          {
            label: TASK_ACTION_LABELS.reject,
            onPress: () => review.sendBack(row),
          },
        ]
      : []),
    ...(editInMore ? [{ label: "Edit", onPress: startEdit }] : []),
    ...restOfMore,
  ];
  // At most three, which Android's dialog can draw: Mark not done needs the
  // task done and Give it back needs it not done, so only one of them shows
  // beside Delete and Delete for everyone. Start needs it To do, so it never
  // shows beside Mark not done, and with Give it back (a task taken from Up
  // for grabs, never a group's copy) there is no Delete for everyone. Send
  // back and Edit are an officer's on someone else's task, so none of those
  // three is beside them, only the two deletes (`taskBarLayout`).
  const openMore = () =>
    showActionMenu({
      title: row.title,
      rows: moreRows,
      userInterfaceStyle: "dark",
    });

  const status = rowStatus(row);
  const due = formatDueDate(row.dueDate);
  const points = formatPointsChip(row.pointReward, row.pointsAwarded);
  const from = row.createdBy
    ? row.createdBy === viewerId
      ? "You"
      : nameOf(row.createdBy)
    : null;
  const groupLabel = rowGroupLabel(row);
  const progress = row.group ?? { done: 0, total: copies.length };
  // Who a group task went to, for anyone Who has it doesn't show to.
  const showFor = groupLabel !== null && !showPeople;
  const history = useMemo(
    () => taskHistory(row, nameInLine, new Date()),
    [row, nameInLine],
  );
  const notice = editing
    ? edit.failure
    : (toggles.refusal ??
      review.refusal?.text ??
      toggles.notice ??
      deleteFailed ??
      edit.failure);
  const pending = toggles.pendingId === row.id;
  // More and the pill's words as the layout counts them, so neither changes
  // while Send back is held out of More.
  const markDoneText = markDoneBarLabel(row.proofKind, rounds);
  const confirmText = confirmBarLabel(row.pointReward, rounds);
  // A member's task with nothing to do and nothing in More draws no bar.
  const barShown =
    controls.markDone ||
    controls.confirm ||
    sendBackRound ||
    editRound ||
    showRemovePeople ||
    showMore;

  return (
    <View style={styles.frame}>
      <ScreenShell
        back={BACK_TO_TASKS}
        // In edit mode the title is the first field, so the heading names
        // the mode instead of saying the title twice.
        title={editing ? "Edit task" : row.title}
        // An officer types steps in the checklist's field, low on the page:
        // the body rises with the keyboard, and a tap on a step's × while it
        // is up works on the first tap.
        avoidKeyboard
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.chipRow}>
          <StatusChip
            label={taskStatusLabel(status)}
            hue={taskStatusHue(status, tokens)}
          />
        </View>

        {editing ? (
          <TaskEditForm
            row={row}
            edit={edit}
            people={{ nameOf, avatarFor, tintFor: avatarTintFor }}
            openWho={whoOnArrival}
            onWhoOpened={() => setWhoOnArrival(false)}
          />
        ) : null}

        {!editing && (due || points || from) ? (
          <TaskFacts>
            {due ? (
              <TaskFact
                label="Due"
                value={due.replace(/^Due /, "")}
                color={
                  row.isOverdue ? tokens.color.semantic.destructiveText : null
                }
              />
            ) : null}
            {points ? (
              <TaskFact
                label="Points"
                value={points.label}
                // Green once the ledger moved; the accent stays Mark done's.
                color={
                  points.tone === "awarded"
                    ? tokens.color.semantic.success
                    : null
                }
              />
            ) : null}
            {from ? <TaskFact label="From" value={from} color={null} /> : null}
          </TaskFacts>
        ) : null}

        {/* Who a group task went to and how far its copies are, on a line
            of its own ("Everyone in Philanthropy · 2 of 6 done" can't fit a
            third of the row), with its meter. Who has it says it for an
            officer instead. */}
        {showFor ? (
          <View style={styles.forFact}>
            <Text style={factStyles.factLabel}>For</Text>
            <GroupProgress
              who={groupLabel}
              done={progress.done}
              total={progress.total}
            />
          </View>
        ) : null}

        {!editing ? <TaskRepeatFact row={row} /> : null}

        {notice ? <Text style={styles.notice}>{notice}</Text> : null}

        {!editing && row.description ? (
          <Text style={styles.description} selectable>
            {row.description}
          </Text>
        ) : null}

        {row.meetingId ? <TaskMinutesFact meetingId={row.meetingId} /> : null}

        {row.subtasks.length > 0 || (controls.edit && !row.pointsAwarded) ? (
          <SubtaskChecklist
            taskId={row.id}
            subtasks={row.subtasks}
            readOnly={row.pointsAwarded}
            canEdit={controls.edit}
          />
        ) : null}

        {/* Photos, the reason it was sent back, and the proof sent with Mark
            done (#4635). Only the assignee and officers can read a task, so
            the proof is the viewer's to see. */}
        <TaskProof
          task={{
            id: row.id,
            // In edit mode the reference photos are the picker's, above.
            photos: editing
              ? row.photos.filter((photo) => photo.kind !== "reference")
              : row.photos,
            proofLink: row.proofLink,
            sentBackReason: row.sentBackReason,
            completionNote: row.completionNote,
          }}
          showProof
          sentBack={rowIsSentBack(row)}
        />

        {showPeople ? (
          <WhoHasIt
            copies={copies}
            who={groupLabel}
            progress={progress}
            people={{ nameOf, avatarFor, tintFor: avatarTintFor }}
            viewerId={viewerId}
            selecting={selecting}
            picked={picked}
            onPick={pick}
            note={
              selecting && removal.everyone ? REMOVE_EVERYONE_NOTE : peopleNote
            }
          />
        ) : null}

        {history.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel} accessibilityRole="header">
              HISTORY
            </Text>
            <View>
              {history.map((line, index) => (
                <HistoryRow
                  key={line.key}
                  title={line.title}
                  meta={line.meta}
                  isLast={index === history.length - 1}
                />
              ))}
            </View>
          </View>
        ) : null}

        {barShown || selecting || editing ? <TaskActionBarSpacer /> : null}
      </ScreenShell>

      {editing ? (
        <TaskActionBar>
          <TaskBarPill
            label="Done"
            hint="Saves what you're typing and closes edit mode."
            glyph={(ink) => <CheckGlyph color={ink} />}
            fill={accent}
            ink={tokens.color.gold.onHouse}
            // Held while a save is out: Done waits on them all.
            busy={finishing || edit.saving}
            onPress={() => void finishEdit()}
          />
        </TaskActionBar>
      ) : selecting ? (
        <TaskActionBar>
          <TaskBarIcon label="Cancel" onPress={stopSelecting}>
            <CloseGlyph color={tokens.color.text.foreground} />
          </TaskBarIcon>
          <TaskBarPill
            label={removeLabel(removal.count)}
            fill={tokens.color.semantic.destructive}
            ink={tokens.color.semantic.onSemantic}
            disabled={!removal.ok}
            busy={removeFromGroup.isPending}
            hint={removal.everyone ? REMOVE_EVERYONE_NOTE : undefined}
            onPress={confirmRemove}
          />
        </TaskActionBar>
      ) : barShown ? (
        <TaskActionBar>
          {controls.markDone ? (
            <TaskBarPill
              label={markDoneText.label}
              hint={markDoneText.hint}
              glyph={(ink) => <CheckGlyph color={ink} />}
              fill={accent}
              ink={tokens.color.gold.onHouse}
              busy={pending}
              onPress={afterEdit(() => void toggles.toggle(row))}
            />
          ) : null}
          {controls.confirm ? (
            <TaskBarPill
              label={confirmText.label}
              hint={review.hint ?? confirmText.hint}
              glyph={(ink) => <CheckGlyph color={ink} />}
              fill={accent}
              ink={tokens.color.gold.onHouse}
              // Its own send reads busy, not dimmed.
              disabled={review.disabled && review.confirmingId !== row.id}
              busy={review.confirmingId === row.id}
              onPress={afterEdit(() => review.confirm(row))}
            />
          ) : null}
          {sendBackRound ? (
            <TaskBarIcon
              label={TASK_ACTION_LABELS.reject}
              hint={
                review.hint ??
                "Opens a sheet for the reason it goes back to its assignee."
              }
              disabled={review.disabled}
              onPress={afterEdit(() => review.sendBack(row))}
            >
              <UndoGlyph color={tokens.color.text.foreground} />
            </TaskBarIcon>
          ) : null}
          {editRound ? (
            <TaskBarIcon
              label="Edit task"
              hint="Changes this task here, a field at a time."
              onPress={startEdit}
            >
              <PencilGlyph color={tokens.color.text.foreground} />
            </TaskBarIcon>
          ) : null}
          {showRemovePeople ? (
            <TaskBarIcon
              label="Remove people"
              hint="Pick members to take out of this task."
              onPress={afterEdit(startSelecting)}
            >
              <MinusGlyph color={tokens.color.text.foreground} />
            </TaskBarIcon>
          ) : null}
          {showMore ? (
            <TaskBarIcon label="More" onPress={afterEdit(openMore)}>
              <MoreGlyph color={tokens.color.text.foreground} />
            </TaskBarIcon>
          ) : null}
        </TaskActionBar>
      ) : null}

      {toggles.undo && !editing ? (
        <UndoBar
          key={toggles.undo.key}
          message={toggles.undo.message}
          onUndo={() => void toggles.takeBack(toggles.undo!.id)}
          // Over the bar, as over a create button: the two sit at one height.
          aboveCreate
        />
      ) : null}

      <MarkDoneHost toggle={toggles} />
      {review.host}
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    frame: {
      flex: 1,
    },
    chipRow: {
      flexDirection: "row",
    },
    // For, on a line of its own under the facts row (`TaskFacts`).
    forFact: {
      gap: tokens.spacing.xs,
    },
    description: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    notice: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructiveText,
    },
    section: {
      gap: tokens.spacing.xs,
    },
    sectionLabel: {
      ...eyebrowStyle(tokens),
      color: tokens.color.text.muted,
    },
  });
}
