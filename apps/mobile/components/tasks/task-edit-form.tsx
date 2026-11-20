import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import { SignetTokens } from "@repo/theme/signet";
import {
  TASK_SERIES_SCOPE_COPY,
  TASK_TITLE_MAX_LENGTH,
  taskRepeatSummary,
  taskSeriesLine,
} from "@repo/validation";
import { localIsoDate, suggestedDueTime } from "@repo/formatting";
import type { MemberAvatarTint } from "@repo/hooks";
import { typeRole, useFrappTheme } from "@/lib/theme";
import { useChapterBranding } from "@/lib/chapter-branding";
import { sheetFieldStyles } from "@/components/sheet-scaffold";
import { DueDateField } from "@/components/tasks/due-date-field";
import { DueTimeField } from "@/components/tasks/due-time-field";
import { TaskPhotoPicker } from "@/components/tasks/task-photos";
import { TaskRepeatField } from "@/components/tasks/repeat-field";
import {
  AssigneeRow,
  PointsField,
  ProofField,
} from "@/components/tasks/task-form-fields";
import { WhoPickerSheet } from "@/components/tasks/who-picker-sheet";
import { FollowerField } from "@/components/tasks/task-follower";
import type { TaskRowModel } from "@/lib/tasks/board";
import {
  dueClearable,
  dueDraftOf,
  referencePhotos,
  repeatDraftOf,
  repeatEditable,
  repeatFirstDue,
  TASK_EDIT_COPY,
} from "@/lib/tasks/task-edit";
import type { TaskEditing } from "@/lib/tasks/use-task-edit";
import { useWhoDirectory } from "@/lib/tasks/use-who-directory";

type TextKey = "title" | "description" | "points";

/** The roster, as Who has it reads it: a member's name, photo and tint. */
interface TaskEditPeople {
  nameOf: (userId: string) => string;
  avatarFor: (userId: string) => string | null;
  tintFor: (userId: string) => MemberAvatarTint;
}

/**
 * The task screen's fields in edit mode (#5514), where the facts row and the
 * description were: the title, the due day and time, the points, the notes,
 * what Mark done needs, the photos, who it is from (#5473) and who it is
 * for, each saving itself as
 * it is left (`useTaskEdit`). The New task sheet's controls, drawn on the
 * screen from the same components (`task-form-fields.tsx`, the platform's
 * date and time pickers, the photo picker). Apple Reminders and Things 3
 * edit a to-do in place the same way, a field at a time with nothing to
 * Save.
 *
 * On a copy of a repeating task (#5119) Repeat sits under the time, as on
 * New task, saved with Done; each save asks "This task only" or "All
 * upcoming tasks" where web's panel does (`useTaskEdit`).
 *
 * On a group task's copy the title, notes, due, points and proof change
 * every copy not yet confirmed, Who hands over this copy alone, and the
 * photos, which change per copy only, are left out; one line says so. Who
 * opens Assign to's picker over the screen, the one place a chooser still
 * rises: a roster of a whole chapter doesn't fit in place.
 */
export function TaskEditForm({
  row,
  edit,
  people,
  openWho = false,
  onWhoOpened,
}: {
  row: TaskRowModel;
  edit: TaskEditing;
  people: TaskEditPeople;
  /** Open Assign to's picker once drawn: a row's long-press Reassign. */
  openWho?: boolean;
  onWhoOpened?: () => void;
}) {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens, accent);
  const [focused, setFocused] = useState<TextKey | null>(null);
  // Read once per visit, so "Add a time" and the earliest day don't move
  // under the officer mid-edit.
  const [openedAt] = useState(() => new Date());
  const isGroup = row.groupId !== null;
  const [repeatOpen, setRepeatOpen] = useState(false);
  const storedRepeat = repeatDraftOf(row);
  const repeat = edit.drafts.repeat ?? storedRepeat;

  // The due as picked, else the task's; `null` is No due date (#5761).
  const picked = edit.drafts.due;
  const due = picked === "none" ? null : (picked ?? dueDraftOf(row));
  const shown = {
    title: edit.drafts.title ?? row.title,
    description: edit.drafts.description ?? row.description ?? "",
    points:
      edit.drafts.points ?? (row.pointReward ? String(row.pointReward) : ""),
  };

  const textProps = (key: TextKey) => ({
    value: shown[key],
    onChangeText: (text: string) => edit.type(key, text),
    onFocus: () => setFocused(key),
    onBlur: () => {
      setFocused(null);
      void edit.commit(key);
    },
    returnKeyType: "done" as const,
    onSubmitEditing: () => void edit.commit(key),
  });

  return (
    <View style={styles.form}>
      <View
        style={[styles.ring, focused === "title" ? styles.ringActive : null]}
      >
        <TextInput
          {...textProps("title")}
          // Wraps so a long title reads whole in place (#5562), still one
          // line of text: Return closes the keyboard, a line break is a space.
          multiline
          submitBehavior="blurAndSubmit"
          onChangeText={(text: string) =>
            edit.type("title", text.replace(/\s*[\r\n]+\s*/g, " "))
          }
          accessibilityLabel="Task title"
          placeholder="Collect ride-share forms"
          placeholderTextColor={tokens.color.text.muted}
          maxLength={TASK_TITLE_MAX_LENGTH}
          style={[
            styles.field,
            styles.titleText,
            focused === "title" ? styles.fieldFocused : null,
          ]}
        />
      </View>

      <View style={styles.splitRow}>
        <View style={[styles.box, styles.split]}>
          <DueDateField
            value={due?.date ?? null}
            today={localIsoDate(openedAt)}
            disabled={false}
            onChange={(date) => edit.pickDue({ date, time: due?.time ?? null })}
            // A copy of a repeating task keeps its day: its series needs one.
            onClear={dueClearable(row) ? () => edit.pickDue("none") : undefined}
          />
        </View>
        <PointsField
          {...textProps("points")}
          focused={focused === "points"}
          style={styles.split}
        />
      </View>

      {due ? (
        <View style={styles.box}>
          <DueTimeField
            value={due.time}
            suggested={suggestedDueTime(due.date, openedAt)}
            disabled={false}
            onChange={(time) => edit.pickDue({ ...due, time })}
          />
        </View>
      ) : null}

      {repeat ? (
        <RepeatEditField
          row={row}
          draft={repeat}
          picked={edit.drafts.repeat !== null}
          open={repeatOpen}
          onOpenChange={setRepeatOpen}
          onChange={edit.pickRepeat}
          disabled={edit.saving}
          fieldStyle={styles.box}
          noteStyle={styles.note}
        />
      ) : null}

      <View
        style={[
          styles.ring,
          focused === "description" ? styles.ringActive : null,
        ]}
      >
        <TextInput
          {...textProps("description")}
          // Return is a new line in the notes; they save when left.
          returnKeyType="default"
          onSubmitEditing={undefined}
          accessibilityLabel="Notes"
          placeholder="Notes"
          placeholderTextColor={tokens.color.text.muted}
          multiline
          style={[
            styles.field,
            styles.multiline,
            focused === "description" ? styles.fieldFocused : null,
          ]}
        />
      </View>

      <ProofField
        value={row.proofKind}
        onChange={edit.setProof}
        disabled={edit.saving}
      />

      {isGroup ? null : (
        <View style={styles.group}>
          <Text style={styles.groupLabel}>Photos</Text>
          <TaskPhotoPicker
            taskId={row.id}
            kept={referencePhotos(row)}
            picked={edit.uploading}
            onRemoveKept={edit.removePhoto}
            // Picks on their way up can't be taken back mid-upload.
            onRemovePicked={() => undefined}
            onAdd={() => void edit.addPhotos()}
            disabled={edit.saving}
            adding={edit.picking}
          />
        </View>
      )}

      <EditFollowerField row={row} edit={edit} />

      {row.assigneeId ? (
        <WhoField
          assigneeId={row.assigneeId}
          people={people}
          onPick={(userId) => edit.reassign(userId, people.nameOf)}
          disabled={edit.saving}
          openOnMount={openWho}
          onOpened={onWhoOpened}
        />
      ) : null}

      {/* One line, said only when there is something to say: a save on its
          way, or how far a group's edit reaches. */}
      {edit.saving ? (
        <Text style={styles.note} accessibilityLiveRegion="polite">
          {TASK_EDIT_COPY.saving}
        </Text>
      ) : isGroup ? (
        <Text style={styles.note}>{TASK_EDIT_COPY.group}</Text>
      ) : null}
    </View>
  );
}

/**
 * Repeat on a copy of a live series (#5119): what it is ("Every Monday ·
 * next Nov 24"), opening the control. Only the copy still to come changes
 * it; an overdue or done copy says to change it from the next.
 */
function RepeatEditField({
  row,
  draft,
  picked,
  open,
  onOpenChange,
  onChange,
  disabled,
  fieldStyle,
  noteStyle,
}: {
  row: TaskRowModel;
  draft: NonNullable<ReturnType<typeof repeatDraftOf>>;
  /** The officer changed it this visit; else it is the series as saved. */
  picked: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (next: typeof draft) => void;
  disabled: boolean;
  fieldStyle: object;
  noteStyle: object;
}) {
  const editable = repeatEditable(row);
  const first = repeatFirstDue(row, draft.timeZone);
  const summary = !first
    ? null
    : !picked
      ? taskSeriesLine(row.series, first, { next: true })
      : taskRepeatSummary(draft, first);
  return (
    <>
      <TaskRepeatField
        draft={draft}
        first={first}
        summary={summary}
        open={open && editable}
        onOpenChange={onOpenChange}
        onChange={onChange}
        disabled={disabled || !editable}
        fieldStyle={fieldStyle}
      />
      {editable ? null : (
        <Text style={noteStyle}>{TASK_SERIES_SCOPE_COPY.repeatFromNext}</Text>
      )}
    </>
  );
}

/**
 * From (#5473): the tier, role or group the task is from, saved as it is
 * picked; on a group task's copy, for every copy. A repeating task says it
 * can't have one yet.
 */
function EditFollowerField({
  row,
  edit,
}: {
  row: TaskRowModel;
  edit: TaskEditing;
}) {
  const { followers } = useWhoDirectory();
  return (
    <FollowerField
      value={row.followedBy}
      currentName={row.followedByName}
      choices={followers}
      onChange={edit.setFollower}
      disabled={edit.saving}
      repeating={row.series !== null}
    />
  );
}

/** Who it is for: the assignee's face and name, opening Assign to. */
function WhoField({
  assigneeId,
  people,
  onPick,
  disabled,
  openOnMount,
  onOpened,
}: {
  assigneeId: string;
  people: TaskEditPeople;
  onPick: (userId: string) => void;
  disabled: boolean;
  openOnMount: boolean;
  onOpened?: () => void;
}) {
  const pickerRef = useRef<BottomSheetModal>(null);
  const whoRead = useWhoDirectory({ groups: false });
  const name = people.nameOf(assigneeId);

  useEffect(() => {
    if (!openOnMount) return;
    pickerRef.current?.present();
    onOpened?.();
  }, [openOnMount, onOpened]);

  return (
    <>
      <AssigneeRow
        label={name}
        name={name}
        avatarUri={people.avatarFor(assigneeId)}
        tint={people.tintFor(assigneeId)}
        disabled={disabled}
        onPress={() => pickerRef.current?.present()}
      />
      <WhoPickerSheet
        ref={pickerRef}
        value={{ kind: "person", userId: assigneeId }}
        onChange={(next) => {
          if (next?.kind === "person") onPick(next.userId);
        }}
        directory={whoRead.directory}
        people={whoRead.people}
        sets={whoRead.sets}
        single
      />
    </>
  );
}

function createStyles(tokens: SignetTokens, accent: string) {
  const fieldStyles = sheetFieldStyles(tokens, accent);
  return StyleSheet.create({
    form: {
      gap: tokens.spacing.sm,
    },
    ring: fieldStyles.ring,
    ringActive: fieldStyles.ringActive,
    field: fieldStyles.field,
    fieldFocused: fieldStyles.fieldFocused,
    titleText: fieldStyles.fieldMultilineText,
    multiline: {
      ...fieldStyles.fieldMultilineText,
      minHeight: tokens.touch.minimum * 2,
    },
    // A field's frame around a control that isn't a text input.
    box: {
      ...fieldStyles.field,
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
    },
    splitRow: {
      flexDirection: "row",
      gap: tokens.spacing.sm,
    },
    split: {
      flex: 1,
    },
    group: {
      gap: tokens.spacing.xs,
    },
    groupLabel: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    note: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
  });
}
