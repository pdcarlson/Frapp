import { forwardRef } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { BottomSheetModal, BottomSheetScrollView } from "@gorhom/bottom-sheet";
import {
  TASK_ACTION_LABELS,
  canReopenOwnTask,
  isTaskStatus,
  taskStatusLabel,
} from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import { typeRole, useFrappTheme } from "@/lib/theme";
import { useChapterBranding } from "@/lib/chapter-branding";
import {
  SheetBackToClose,
  SheetGrabber,
  SheetPrimaryButton,
  SheetScrim,
  useSheetBackgroundStyle,
  useSheetClose,
  SHEET_STACK_BEHAVIOR,
} from "@/components/sheet-scaffold";
import { PressableRow } from "@/components/list-section";
import { formatDueDate, formatPointsChip } from "@/lib/tasks/format";
import {
  rowIsSentBack,
  rowNeedsSignOff,
  rowSignedOffAutomatically,
  type TaskRowModel,
} from "@/lib/tasks/board";
import { markDoneLabel } from "@/lib/tasks/task-photos";
import { SubtaskChecklist } from "@/components/tasks/subtask-checklist";
import { TaskProof } from "@/components/tasks/task-photos";

/**
 * A task, opened: what the row has no room for (owner audit 2026-11-06, P6.1,
 * "there's no way to open a task to read its description").
 *
 * A tap on a board row opens it; only the row's checkbox changes the task.
 * Here the same move is a labelled button, and the status says who the task
 * is waiting on in the shared words web uses (`TASK_STATUS_LABELS`), so a
 * member never reads "done" where an officer still has to confirm.
 *
 * It shows the task's photos and, once there is one, the officer's reason
 * for sending it back and the proof the member sent (#4635). Mark done names
 * what the task asks for ("Mark done with a photo") and, on such a task or a
 * sent-back one, the board opens Mark done's sheet.
 *
 * An officer also gets Edit beside the title (#4296), which opens the New
 * task sheet's fields on the task, and adds or removes its steps in the
 * checklist here; a confirmed task has neither, its points being paid.
 * Deleting stays on the web board. Short content, so the sheet sizes to
 * it; the scroller is the modal's direct child, so a long description scrolls
 * inside the sheet rather than pushing the button off screen.
 */
export interface TaskDetailSheetProps {
  /** The opened row, or `null` while none is. The sheet stays mounted. */
  row: TaskRowModel | null;
  /** The officer who assigned it, resolved by the screen; `null` if unknown. */
  assignedBy: string | null;
  /** The checkbox's move. Omitted while it is unavailable (in flight, refused). */
  onToggle?: () => void;
  /** Why the move is unavailable, said under the button. */
  refusal?: string | null;
  /**
   * An officer's Edit (#4296), omitted for anyone else and for a confirmed
   * task. Also lets the checklist add and remove steps.
   */
  onEdit?: () => void;
  onDismiss?: () => void;
}

export const TaskDetailSheet = forwardRef<
  BottomSheetModal,
  TaskDetailSheetProps
>(function TaskDetailSheet(
  { row, assignedBy, onToggle, refusal, onEdit, onDismiss },
  ref,
) {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens);
  const backgroundStyle = useSheetBackgroundStyle();
  const closeSheet = useSheetClose(ref);

  const stored = isTaskStatus(row?.storedStatus)
    ? row?.storedStatus
    : undefined;
  const display = isTaskStatus(row?.displayStatus) ? row.displayStatus : stored;
  const status =
    row && display
      ? taskStatusLabel({
          status: display,
          stored_status: stored,
          points_awarded: row.pointsAwarded,
          sent_back_at: row.sentBackAt,
          point_reward: row.pointReward,
          proof_kind: row.proofKind,
        })
      : null;
  const signOff = row ? rowNeedsSignOff(row) : true;
  const sentBack = row ? rowIsSentBack(row) : false;
  const reopenable = row
    ? canReopenOwnTask({
        stored,
        pointsAwarded: row.pointsAwarded,
        isAssignee: true,
        signedOffAutomatically: rowSignedOffAutomatically(row),
      })
    : false;
  const chip = row
    ? formatPointsChip(row.pointReward, row.pointsAwarded)
    : null;
  const due = row ? formatDueDate(row.dueDate) : null;
  // What the status means for this member, in one line. The waiting line is
  // the whole point of the audit finding: done is the member's half. It names
  // no one: any officer can confirm, and never the member themselves, even
  // one who assigned it to themselves (the API refuses a self-confirm).
  const meaning = !row
    ? null
    : row.isDone && !signOff
      ? // Done as it was marked (#4635): no points, no proof, nothing waits
        // on an officer.
        "You marked this done. Nothing waits on an officer."
      : row.isDone && row.pointsAwarded
        ? row.pointReward
          ? `Confirmed. The ${row.pointReward} points are yours.`
          : "Confirmed."
        : row.isDone
          ? `You marked this done. An officer confirms it${
              row.pointReward ? " before the points count" : ""
            }.`
          : null;

  return (
    <BottomSheetModal
      ref={ref}
      stackBehavior={SHEET_STACK_BEHAVIOR}
      enableDynamicSizing
      backgroundStyle={backgroundStyle}
      handleComponent={SheetGrabber}
      backdropComponent={SheetScrim}
      onDismiss={onDismiss}
    >
      <SheetBackToClose onClose={closeSheet} />
      <BottomSheetScrollView
        onAccessibilityEscape={closeSheet}
        contentContainerStyle={styles.body}
      >
        {row ? (
          <>
            <View style={styles.head}>
              <View style={styles.titleRow}>
                <Text style={styles.title} accessibilityRole="header">
                  {row.title}
                </Text>
                {/* Where Apple Reminders and Calendar put Edit: a word at the
                    top right, not another button in the sheet's body, where
                    Mark done is the one thing to do. Neutral, not the accent,
                    which goes to that one primary action (foundations §6). */}
                {onEdit ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Edit ${row.title}`}
                    onPress={onEdit}
                    hitSlop={{ top: 14, bottom: 14, left: 12, right: 12 }}
                  >
                    <Text style={styles.edit}>Edit</Text>
                  </Pressable>
                ) : null}
              </View>
              {status ? (
                <Text
                  style={[
                    styles.status,
                    row.isOverdue ? styles.statusUrgent : null,
                  ]}
                >
                  {status}
                </Text>
              ) : null}
            </View>

            <View style={styles.facts}>
              {due ? (
                <Fact label="Due" value={due.replace(/^Due /, "")} />
              ) : null}
              {chip ? <Fact label="Points" value={chip.label} /> : null}
              {assignedBy ? (
                <Fact label="Assigned by" value={assignedBy} />
              ) : null}
            </View>

            {row.description ? (
              <Text style={styles.description} selectable>
                {row.description}
              </Text>
            ) : null}

            {/* Photos, the reason it was sent back, and the proof sent with
                Mark done (#4635). The board is the viewer's own tasks, so
                the proof is theirs to see. */}
            <TaskProof
              task={{
                id: row.id,
                photos: row.photos,
                proofLink: row.proofLink,
                sentBackReason: row.sentBackReason,
                completionNote: row.completionNote,
              }}
              showProof
              sentBack={sentBack}
            />

            {row.subtasks.length > 0 || (onEdit && !row.pointsAwarded) ? (
              <SubtaskChecklist
                taskId={row.id}
                subtasks={row.subtasks}
                readOnly={row.pointsAwarded}
                canEdit={onEdit !== undefined}
              />
            ) : null}

            {meaning ? <Text style={styles.meaning}>{meaning}</Text> : null}

            {!row.isDone && onToggle ? (
              <SheetPrimaryButton
                label={markDoneLabel(
                  TASK_ACTION_LABELS.complete,
                  row.proofKind,
                )}
                onPress={onToggle}
                accent={accent}
                onAccent={tokens.color.gold.onHouse}
              />
            ) : null}

            {/* Quiet, not a second accent button: taking back a "done" is the
                rare move, and the accent is for the one thing to do here. */}
            {reopenable && onToggle ? (
              <PressableRow
                accessibilityRole="button"
                onPress={onToggle}
                style={styles.quietButton}
              >
                <Text style={styles.quietLabel}>
                  {TASK_ACTION_LABELS.reopen}
                </Text>
              </PressableRow>
            ) : null}

            {refusal ? <Text style={styles.refusal}>{refusal}</Text> : null}
          </>
        ) : null}
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
});

function Fact({ label, value }: { label: string; value: string }) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  return (
    <View
      style={styles.fact}
      accessible
      accessibilityLabel={`${label}: ${value}`}
    >
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    body: {
      paddingHorizontal: tokens.spacing.lg,
      paddingTop: tokens.spacing.sm,
      paddingBottom: tokens.spacing["2xl"],
      gap: tokens.spacing.lg,
    },
    head: {
      gap: tokens.spacing.xs,
    },
    titleRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: tokens.spacing.md,
    },
    title: {
      flex: 1,
      ...typeRole(tokens.typography.role.title),
      color: tokens.color.text.foreground,
    },
    edit: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    status: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    statusUrgent: {
      color: tokens.color.semantic.destructiveText,
    },
    facts: {
      gap: tokens.spacing.sm,
    },
    fact: {
      flexDirection: "row",
      justifyContent: "space-between",
      gap: tokens.spacing.md,
    },
    factLabel: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
    },
    factValue: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
      flexShrink: 1,
    },
    description: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    meaning: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    quietButton: {
      minHeight: tokens.touch.minimum,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: tokens.radius.control,
    },
    quietLabel: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    refusal: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructiveText,
    },
  });
}
