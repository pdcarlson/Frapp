import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import { SignetTokens } from "@repo/theme/signet";
import {
  TASK_PROOF_KIND_HINTS,
  TASK_PROOF_KIND_LABELS,
  TASK_PROOF_KINDS,
} from "@repo/validation";
import { localIsoDate, suggestedDueTime } from "@repo/formatting";
import type { MemberAvatarTint } from "@repo/hooks";
import {
  avatarRadius,
  fieldTypeRole,
  typeRole,
  useFrappTheme,
} from "@/lib/theme";
import {
  useChapterBranding,
  type ChapterBranding,
} from "@/lib/chapter-branding";
import { initialsFor } from "@/lib/more/narrow";
import { MemberAvatar } from "@/components/member-avatar";
import { sheetFieldStyles } from "@/components/sheet-scaffold";
import { Segmented } from "@/components/segmented";
import { DueDateField } from "@/components/tasks/due-date-field";
import { DueTimeField } from "@/components/tasks/due-time-field";
import { TaskPhotoPicker } from "@/components/tasks/task-photos";
import { WhoPickerSheet } from "@/components/tasks/who-picker-sheet";
import { TITLE_MAX_LENGTH } from "@/lib/tasks/limits";
import type { TaskRowModel } from "@/lib/tasks/board";
import {
  dueDraftOf,
  referencePhotos,
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
 * what Mark done needs, the photos and who it is for, each saving itself as
 * it is left (`useTaskEdit`). The New task sheet's controls, drawn on the
 * screen: the platform's date and time pickers (`DueDateField`,
 * `DueTimeField`), the accent "+" points field, the app's segmented control
 * and the photo picker. Apple Reminders and Things 3 edit a to-do in place
 * the same way, a field at a time with nothing to Save.
 *
 * A group task's copy edits every copy not yet confirmed, so it leaves out
 * who it is for and its photos, which change per copy only, and says so.
 * Who opens Assign to's picker over the screen, the one place a chooser
 * still rises: a roster of a whole chapter doesn't fit in place.
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
  const brand = useChapterBranding();
  const styles = createStyles(tokens, brand);
  const [focused, setFocused] = useState<TextKey | null>(null);
  // Read once per visit, so "Add a time" and the earliest day don't move
  // under the officer mid-edit.
  const [openedAt] = useState(() => new Date());
  const isGroup = row.groupId !== null;

  const due = edit.drafts.due ?? dueDraftOf(row);
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
    placeholderTextColor: tokens.color.text.muted,
  });

  return (
    <View style={styles.form}>
      <View
        style={[styles.ring, focused === "title" ? styles.ringActive : null]}
      >
        <TextInput
          {...textProps("title")}
          accessibilityLabel="Task title"
          placeholder="Collect ride-share forms"
          maxLength={TITLE_MAX_LENGTH}
          returnKeyType="done"
          onSubmitEditing={() => void edit.commit("title")}
          style={[
            styles.field,
            focused === "title" ? styles.fieldFocused : null,
          ]}
        />
      </View>

      {due ? (
        <View style={styles.splitRow}>
          <View style={[styles.box, styles.split]}>
            <DueDateField
              value={due.date}
              today={localIsoDate(openedAt)}
              disabled={false}
              onChange={(date) => edit.pickDue({ ...due, date })}
            />
          </View>
          <View
            style={[
              styles.box,
              styles.split,
              focused === "points" ? styles.fieldFocused : null,
            ]}
          >
            <Text style={[styles.pointsSign, { color: brand.accent }]}>+</Text>
            <TextInput
              {...textProps("points")}
              accessibilityLabel="Point reward"
              placeholder="pts"
              keyboardType="number-pad"
              returnKeyType="done"
              onSubmitEditing={() => void edit.commit("points")}
              style={styles.pointsInput}
            />
          </View>
        </View>
      ) : null}

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

      <View
        style={[
          styles.ring,
          focused === "description" ? styles.ringActive : null,
        ]}
      >
        <TextInput
          {...textProps("description")}
          accessibilityLabel="Notes"
          placeholder="Notes"
          multiline
          style={[
            styles.field,
            styles.multiline,
            focused === "description" ? styles.fieldFocused : null,
          ]}
        />
      </View>

      <View style={styles.group}>
        <Text style={styles.groupLabel}>Proof</Text>
        <Segmented
          options={TASK_PROOF_KINDS.map((kind) => ({
            value: kind,
            label: TASK_PROOF_KIND_LABELS[kind],
          }))}
          value={row.proofKind}
          onChange={edit.setProof}
          accessibilityLabel="Proof to mark it done"
          disabled={edit.saving}
        />
        <Text style={styles.note}>{TASK_PROOF_KIND_HINTS[row.proofKind]}</Text>
      </View>

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

      {isGroup || !row.assigneeId ? null : (
        <WhoField
          assigneeId={row.assigneeId}
          people={people}
          onPick={(userId) => edit.reassign(userId, people.nameOf)}
          disabled={edit.saving}
          openOnMount={openWho}
          onOpened={onWhoOpened}
        />
      )}

      {/* One line, said only when there is something to say: a group's
          reach, or a save on its way. */}
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
  const { tokens } = useFrappTheme();
  const brand = useChapterBranding();
  const styles = createStyles(tokens, brand);
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
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Assignee: ${name}`}
        accessibilityHint="Choose who this task is for."
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={() => pickerRef.current?.present()}
        style={styles.assigneeRow}
      >
        <MemberAvatar
          uri={people.avatarFor(assigneeId)}
          initials={initialsFor(name)}
          size={avatarSize(tokens)}
          style={styles.avatar}
          textStyle={styles.avatarText}
          tint={people.tintFor(assigneeId)}
        />
        <Text style={styles.fieldValue} numberOfLines={1}>
          {name}
        </Text>
        <Text style={styles.note}>assignee</Text>
      </Pressable>
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

/** 24pt, Who has it's and the member rows' avatar. */
const avatarSize = (tokens: SignetTokens) => tokens.spacing.xl;

function createStyles(tokens: SignetTokens, brand: ChapterBranding) {
  const fieldStyles = sheetFieldStyles(tokens, brand.accent);
  return StyleSheet.create({
    form: {
      gap: tokens.spacing.sm,
    },
    ring: fieldStyles.ring,
    ringActive: fieldStyles.ringActive,
    field: fieldStyles.field,
    fieldFocused: fieldStyles.fieldFocused,
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
    pointsSign: {
      ...typeRole(tokens.typography.role.label),
    },
    pointsInput: {
      flex: 1,
      // No lineHeight on a single-line input, or iOS draws the text low.
      ...fieldTypeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
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
    assigneeRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tokens.color.border.input,
      backgroundColor: tokens.color.surface.surface1,
      paddingHorizontal: tokens.spacing.md,
      minHeight: tokens.touch.minimum,
    },
    fieldValue: {
      flex: 1,
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    avatar: {
      width: avatarSize(tokens),
      height: avatarSize(tokens),
      borderRadius: avatarRadius(avatarSize(tokens)),
      backgroundColor: tokens.color.surface.popover,
      alignItems: "center",
      justifyContent: "center",
    },
    avatarText: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
  });
}
