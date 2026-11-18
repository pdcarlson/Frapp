import { describeLoadFailure, errorCopy } from "@repo/hooks/error-copy";
import { statusOf } from "@repo/api-sdk";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import { AccessibilityInfo, Alert, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";
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
import { memberLabel } from "@repo/hooks/display-names";
import { can, TASK_AUDIENCE_COPY } from "@repo/validation";
import { SignetTokens } from "@repo/theme/signet";
import { ScreenShell } from "@/components/screen-shell";
import { BACK_TO_TASKS } from "@/components/back-row";
import {
  ErrorState,
  SkeletonBlock,
  SkeletonRegion,
  SkeletonText,
} from "@/components/state-block";
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
} from "@/components/control-glyphs";
import { SubtaskChecklist } from "@/components/tasks/subtask-checklist";
import { TaskProof } from "@/components/tasks/task-photos";
import { NewTaskSheet } from "@/components/tasks/new-task-sheet";
import { UndoBar } from "@/components/tasks/undo-bar";
import {
  TaskActionBar,
  TaskActionBarSpacer,
  TaskBarIcon,
  TaskBarPill,
} from "@/components/tasks/task-action-bar";
import { WhoHasIt } from "@/components/tasks/who-has-it";
import { useChapterBranding } from "@/lib/chapter-branding";
import { useDropKeptSheetDraft } from "@/lib/kept-sheet-draft";
import { showActionMenu } from "@/lib/action-menu";
import { goBackTo } from "@/lib/href";
import { rowIsSentBack, toTaskRow, type TaskRowModel } from "@/lib/tasks/board";
import { formatDueDate, formatPointsChip } from "@/lib/tasks/format";
import { markDoneLabel } from "@/lib/tasks/task-photos";
import { taskStatusHue } from "@/lib/tasks/status-hue";
import type { TaskEditTarget } from "@/lib/tasks/create-task";
import {
  groupCopies,
  removalAllowed,
  removeConfirmTitle,
  REMOVE_CONFIRM_BODY,
  REMOVE_EVERYONE_NOTE,
  removedLine,
  rowGroupLabel,
  removeLabel,
  rowStatus,
  sortCopies,
  taskHistory,
  taskLink,
  taskScreenControls,
} from "@/lib/tasks/task-screen";
import { MarkDoneHost, useTaskToggle } from "@/lib/tasks/use-task-toggle";
import { RELEASE_FAILED, RELEASED_LINE } from "@/lib/tasks/open-tasks";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * One task as its own pushed screen (#5492), where the task detail sheet used
 * to rise (Paul, 2026-11-18: "I'm not a super fan of the sheet that pops up
 * when you do tap on a task. I think that's lazy"). Built like Event details:
 * `ScreenShell`, the task's title, and the task's parts top to bottom, as
 * Linear's issue page lays out a pushed issue.
 *
 * Reached from a row on the task board, from the Calendar's task rows, and
 * from a task push through the board (`/tasks?task=<id>`), with an `id`.
 *
 * ## What it shows
 *
 * The status as a colour chip in the shared words (`taskStatusLabel`); a row
 * of three facts, Due, Points and From, as Linear's issue header lists them;
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
 * 40pt rounds. More opens the system menu: Copy link, Mark not done, Delete
 * and, on a group task, Delete for everyone. Each shows only to a viewer the
 * API lets use it (`taskScreenControls`).
 *
 * ## Remove people
 *
 * The minus turns Who has it into a select mode on this screen, as Apple
 * Mail's Edit puts a circle on each message: a confirmed copy is dimmed and
 * can't be picked, and the bar becomes one red Remove pill and a Cancel. It
 * asks first in the platform alert, since the copies are deleted and can't be
 * brought back, then `POST /v1/tasks/:id/group/remove`.
 */
export default function TaskDetailsScreen() {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const taskId = Array.isArray(params.id) ? params.id[0] : (params.id ?? "");

  const taskQuery = useTask(taskId);
  const row = useMemo(
    () =>
      taskQuery.data && typeof taskQuery.data === "object"
        ? toTaskRow(taskQuery.data as Record<string, unknown>)
        : null,
    [taskQuery.data],
  );

  // An edit kept past this screen (#4872) goes with its task: one deleted
  // since has no sheet to open it in.
  const taskGone =
    !taskQuery.isPending &&
    taskQuery.isError &&
    statusOf(taskQuery.error) === 404;
  useDropKeptSheetDraft(taskId ? `task-edit:${taskId}` : null, taskGone);

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

  return <TaskScreen row={row} styles={styles} />;
}

function TaskScreen({
  row,
  styles,
}: {
  row: TaskRowModel;
  styles: ReturnType<typeof createStyles>;
}) {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const router = useRouter();
  const viewerId = useViewerUserId();
  const canManage = can("tasks:manage", usePermissionList());
  const roster = useMemberDisplayNames();
  const { byId, avatarFor, avatarTintFor } = roster;
  const nameOf = useCallback(
    (userId: string) => memberLabel(byId[userId], userId),
    [byId],
  );
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
  const toggles = useTaskToggle(findRow);
  const controls = taskScreenControls({
    row,
    viewerId,
    canManage,
    toggleRefused: toggles.refusal !== null,
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
  const startSelecting = () => {
    setPeopleNote(null);
    setPicked(new Set());
    setSelecting(true);
  };
  const stopSelecting = () => {
    setSelecting(false);
    setPicked(new Set());
  };
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
      if (row.assigneeId && result.removed.includes(row.assigneeId)) {
        goBackTo(router, BACK_TO_TASKS.href);
      }
    } catch (error) {
      setPeopleNote(
        errorCopy(error, "Couldn't take them out. Try again.", {
          serverWritesForMembers: true,
        }),
      );
    }
  };
  const confirmRemove = () => {
    const assigneeIds = [...picked];
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

  // Edit: the board's Edit task sheet, opened on this copy. One sheet per
  // edit, mounted for it and gone once it closes, so its fields start from
  // the task as it stands.
  const editRef = useRef<BottomSheetModal>(null);
  const [openedAt] = useState(() => new Date());
  const [editing, setEditing] = useState<TaskEditTarget | null>(null);
  useEffect(() => {
    if (editing) editRef.current?.present();
  }, [editing]);
  const startEdit = () => {
    if (!row.assigneeId || !row.dueDay) return;
    setEditing({
      id: row.id,
      title: row.title,
      assigneeId: row.assigneeId,
      dueDay: row.dueDay,
      dueAt: row.dueAt,
      pointReward: row.pointReward,
      storedStatus: row.storedStatus,
      referencePhotos: row.photos.filter((photo) => photo.kind === "reference"),
      proofKind: row.proofKind,
    });
  };

  // Delete, after the platform alert, then back to the board.
  const deleteTask = useDeleteTask();
  const [deleteFailed, setDeleteFailed] = useState<string | null>(null);
  const runDelete = async (everyone: boolean) => {
    setDeleteFailed(null);
    try {
      await deleteTask.mutateAsync(
        everyone ? { id: row.id, scope: "group" } : row.id,
      );
      goBackTo(router, BACK_TO_TASKS.href);
    } catch (error) {
      setDeleteFailed(errorCopy(error, "Couldn't delete the task. Try again."));
    }
  };
  const confirmDelete = (everyone: boolean) =>
    Alert.alert(
      everyone
        ? `Delete "${row.title}" for everyone?`
        : `Delete "${row.title}"?`,
      everyone
        ? "Every member's copy goes, including ones already marked done. This can't be undone."
        : "This can't be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: everyone ? "Delete for everyone" : "Delete task",
          style: "destructive",
          onPress: () => void runDelete(everyone),
        },
      ],
    );

  // Give it back (tasks.md § Up for grabs): the task is deleted and its
  // posting is open again, so there is nothing left here to show.
  const releaseTask = useReleaseTask();
  const runRelease = () => {
    setDeleteFailed(null);
    releaseTask.mutate(row.id, {
      onSuccess: () => {
        AccessibilityInfo.announceForAccessibility(RELEASED_LINE);
        goBackTo(router, BACK_TO_TASKS.href);
      },
      onError: (error) =>
        setDeleteFailed(
          errorCopy(error, RELEASE_FAILED, { serverWritesForMembers: true }),
        ),
    });
  };

  const openMore = () => {
    const copyLink = {
      label: "Copy link",
      onPress: () =>
        void Clipboard.setStringAsync(taskLink(row.id)).then(() =>
          AccessibilityInfo.announceForAccessibility("Link copied"),
        ),
    };
    const rest = [
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
    showActionMenu({
      title: row.title,
      rows: [copyLink, ...rest],
      userInterfaceStyle: "dark",
      // Android's dialog draws three buttons at most: the task's own moves
      // keep their place and Copy link gives way.
      android: rest.length >= 3 ? { rows: rest } : undefined,
    });
  };

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
  const forLine =
    groupLabel && !showPeople
      ? `${groupLabel} · ${TASK_AUDIENCE_COPY.progress(progress.done, progress.total)}`
      : null;
  const history = useMemo(
    () => taskHistory(row, nameInLine, new Date()),
    [row, nameInLine],
  );
  const notice = toggles.refusal ?? toggles.notice ?? deleteFailed;
  const markDoneText = markDoneLabel(
    TASK_ACTION_LABELS.complete,
    row.proofKind,
  );
  const pending = toggles.pendingId === row.id;

  return (
    <View style={styles.frame}>
      <ScreenShell back={BACK_TO_TASKS} title={row.title}>
        <View style={styles.chipRow}>
          <StatusChip
            label={taskStatusLabel(status)}
            hue={taskStatusHue(status, tokens)}
          />
        </View>

        {due || points || forLine || from ? (
          <View style={styles.facts}>
            {due ? (
              <Fact
                label="Due"
                value={due.replace(/^Due /, "")}
                color={
                  row.isOverdue ? tokens.color.semantic.destructiveText : null
                }
              />
            ) : null}
            {points ? (
              <Fact
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
            {/* Who a group task went to, with how far its copies are, as
                the sheet said it ("Everyone in Philanthropy · 2 of 6
                done"). Who has it says it for an officer instead. */}
            {forLine ? <Fact label="For" value={forLine} color={null} /> : null}
            {from ? <Fact label="From" value={from} color={null} /> : null}
          </View>
        ) : null}

        {notice ? <Text style={styles.notice}>{notice}</Text> : null}

        {row.description ? (
          <Text style={styles.description} selectable>
            {row.description}
          </Text>
        ) : null}

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
            photos: row.photos,
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

        <TaskActionBarSpacer />
      </ScreenShell>

      {selecting ? (
        <TaskActionBar>
          <TaskBarIcon label="Cancel" onPress={stopSelecting}>
            <CloseGlyph color={tokens.color.text.foreground} />
          </TaskBarIcon>
          <TaskBarPill
            label={removeLabel(picked.size)}
            fill={tokens.color.semantic.destructive}
            ink={tokens.color.semantic.onSemantic}
            disabled={!removal.ok}
            busy={removeFromGroup.isPending}
            hint={removal.everyone ? REMOVE_EVERYONE_NOTE : undefined}
            onPress={confirmRemove}
          />
        </TaskActionBar>
      ) : (
        <TaskActionBar>
          {controls.markDone ? (
            <TaskBarPill
              label={markDoneText}
              glyph={(ink) => <CheckGlyph color={ink} />}
              fill={accent}
              ink={tokens.color.gold.onHouse}
              busy={pending}
              onPress={() => void toggles.toggle(row)}
            />
          ) : null}
          {controls.edit ? (
            <TaskBarIcon
              label="Edit task"
              hint="Opens a sheet to change this task."
              onPress={startEdit}
            >
              <PencilGlyph color={tokens.color.text.foreground} />
            </TaskBarIcon>
          ) : null}
          {controls.removePeople && showPeople ? (
            <TaskBarIcon
              label="Remove people"
              hint="Pick members to take out of this task."
              onPress={startSelecting}
            >
              <MinusGlyph color={tokens.color.text.foreground} />
            </TaskBarIcon>
          ) : null}
          <TaskBarIcon label="More" onPress={openMore}>
            <MoreGlyph color={tokens.color.text.foreground} />
          </TaskBarIcon>
        </TaskActionBar>
      )}

      {toggles.undo ? (
        <UndoBar
          key={toggles.undo.key}
          message={toggles.undo.message}
          onUndo={() => void toggles.takeBack(toggles.undo!.id)}
          // Over the bar, as over a create button: the two sit at one height.
          aboveCreate
        />
      ) : null}

      <MarkDoneHost toggle={toggles} />

      {editing ? (
        <NewTaskSheet
          key={editing.id}
          ref={editRef}
          now={openedAt}
          editing={editing}
          // Kept past a close and this screen (#4872): Edit on the same task
          // again opens on what was typed, over the task as it is now.
          keptDraft={`task-edit:${editing.id}`}
          onClosed={() => setEditing(null)}
        />
      ) : null}
    </View>
  );
}

/** One of the three facts: a caption over its value, as Linear's header. */
function Fact({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  /** A status colour for the value, or `null` for the foreground. */
  color: string | null;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  return (
    <View
      style={styles.fact}
      accessible
      accessibilityLabel={`${label}: ${value}`}
    >
      <Text style={styles.factLabel}>{label}</Text>
      <Text
        style={[styles.factValue, color ? { color } : null]}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
}

/**
 * The loading state, on the loaded screen's own shapes: the status chip and
 * the facts row. The description, checklist and the rest are left out, since
 * each draws only when the task has one.
 */
export function TaskDetailSkeleton() {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const { caption, label } = tokens.typography.role;
  return (
    <SkeletonRegion label="Loading task" style={styles.skeleton}>
      <SkeletonBlock
        width={tokens.spacing["3xl"] + tokens.spacing.lg}
        height={tokens.spacing.xl}
        radius={tokens.radius.control}
      />
      <View style={styles.facts}>
        {[0, 1, 2].map((index) => (
          <View key={index} style={styles.fact}>
            <SkeletonText role={caption} width="40%" />
            <SkeletonText role={label} width="70%" />
          </View>
        ))}
      </View>
    </SkeletonRegion>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    frame: {
      flex: 1,
    },
    skeleton: {
      gap: tokens.spacing.md,
    },
    chipRow: {
      flexDirection: "row",
    },
    facts: {
      flexDirection: "row",
      flexWrap: "wrap",
      rowGap: tokens.spacing.sm,
      columnGap: tokens.spacing.md,
    },
    fact: {
      // Three to a line; a fourth (For) wraps under them.
      flexGrow: 1,
      flexBasis: "28%",
      gap: tokens.spacing.xs,
    },
    factLabel: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
    },
    factValue: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
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
