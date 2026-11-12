import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { BottomSheetTextInput } from "@gorhom/bottom-sheet";
import Svg, { Path } from "react-native-svg";
import {
  useAddSubtask,
  useDeleteSubtask,
  useSetSubtaskDone,
} from "@repo/hooks";
import {
  TASK_SUBTASK_TITLE_MAX_LENGTH,
  TASK_SUBTASKS_MAX,
} from "@repo/validation";
import { SignetTokens } from "@repo/theme/signet";
import { fieldTypeRole, tint, typeRole, useFrappTheme } from "@/lib/theme";
import { CheckGlyph } from "@/components/tasks/task-glyphs";
import type { TaskRowSubtask } from "@/lib/tasks/board";

/**
 * A task's subtasks in its detail sheet (#4003): the steps of the chore,
 * each a row the assignee taps to check off, like a checklist in Apple
 * Reminders. The tap flips the box at once (`useSetSubtaskDone` writes the
 * cache first) and a refusal puts it back. `readOnly` once the task is
 * confirmed: its points are paid and the API keeps its steps where they are.
 *
 * An officer (`canEdit`) also takes a step away with its × and adds one at
 * the end with the field under the list (#4296), as on web's tile, so a
 * task's steps change after it is made on mobile too. Return adds the step
 * and keeps the keyboard up for the next, as the New task sheet's field does.
 */
export function SubtaskChecklist({
  taskId,
  subtasks,
  readOnly,
  canEdit = false,
}: {
  taskId: string;
  subtasks: TaskRowSubtask[];
  readOnly: boolean;
  /** An officer who can manage tasks: may add and remove steps. */
  canEdit?: boolean;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const setDone = useSetSubtaskDone();
  const addSubtask = useAddSubtask();
  const deleteSubtask = useDeleteSubtask();
  const [text, setText] = useState("");
  const [failed, setFailed] = useState<string | null>(null);
  const done = subtasks.filter((subtask) => subtask.done).length;
  const editable = canEdit && !readOnly;
  const muted = tokens.color.text.mutedForeground;

  const add = () => {
    const title = text.trim();
    if (!title || addSubtask.isPending) return;
    setText("");
    setFailed(null);
    addSubtask.mutate(
      { taskId, title },
      {
        onError: () => {
          // The typed step comes back, so nothing is lost to a failed add.
          setText((current) => current || title);
          setFailed("That subtask didn't save. Try again.");
        },
      },
    );
  };

  return (
    <View style={styles.section}>
      <Text style={styles.heading}>
        {subtasks.length > 0
          ? `Subtasks · ${done} of ${subtasks.length}`
          : "Subtasks"}
      </Text>
      {subtasks.map((subtask) => (
        <View key={subtask.id} style={styles.line}>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: subtask.done, disabled: readOnly }}
            accessibilityLabel={subtask.title}
            disabled={readOnly}
            onPress={() =>
              setDone.mutate({
                taskId,
                subtaskId: subtask.id,
                done: !subtask.done,
              })
            }
            style={styles.row}
          >
            <View style={[styles.box, subtask.done ? styles.boxDone : null]}>
              {subtask.done ? (
                <CheckGlyph
                  color={tokens.color.text.mutedForeground}
                  size={11}
                />
              ) : null}
            </View>
            <Text
              style={[styles.title, subtask.done ? styles.titleDone : null]}
            >
              {subtask.title}
            </Text>
          </Pressable>
          {editable ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove subtask: ${subtask.title}`}
              hitSlop={10}
              onPress={() => {
                setFailed(null);
                deleteSubtask.mutate(
                  { taskId, subtaskId: subtask.id },
                  {
                    onError: () =>
                      setFailed("That subtask is still there. Try again."),
                  },
                );
              }}
              style={styles.remove}
            >
              <CrossGlyph color={muted} />
            </Pressable>
          ) : null}
        </View>
      ))}
      {editable && subtasks.length < TASK_SUBTASKS_MAX ? (
        <View style={styles.row}>
          <View style={[styles.box, styles.boxAdd]} />
          <BottomSheetTextInput
            value={text}
            onChangeText={setText}
            placeholder={subtasks.length === 0 ? "Add a subtask" : "Next step"}
            placeholderTextColor={tokens.color.text.muted}
            accessibilityLabel="Add a subtask"
            maxLength={TASK_SUBTASK_TITLE_MAX_LENGTH}
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={add}
            style={styles.input}
          />
        </View>
      ) : null}
      {failed ? <Text style={styles.error}>{failed}</Text> : null}
    </View>
  );
}

function CrossGlyph({ color }: { color: string }) {
  return (
    <Svg width={14} height={14} viewBox="0 0 24 24">
      <Path
        d="M6 6l12 12M18 6L6 18"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
      />
    </Svg>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    section: {
      gap: tokens.spacing.xs,
    },
    heading: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    line: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
    },
    row: {
      flex: 1,
      minHeight: tokens.touch.minimum,
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
    },
    box: {
      width: 18,
      height: 18,
      borderRadius: tokens.radius.chip,
      borderWidth: 1.5,
      borderColor: tint(tokens.color.text.foreground, 0.25),
      alignItems: "center",
      justifyContent: "center",
    },
    boxDone: {
      borderColor: tokens.color.border.input,
      backgroundColor: tokens.color.surface.popover,
    },
    // The add line's box is quieter: a step that isn't one yet.
    boxAdd: {
      borderColor: tokens.color.border.input,
    },
    title: {
      flex: 1,
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    titleDone: {
      color: tokens.color.text.mutedForeground,
      textDecorationLine: "line-through",
    },
    remove: {
      padding: tokens.spacing.xs,
    },
    input: {
      flex: 1,
      // No lineHeight on a single-line input, or iOS draws the text low.
      ...fieldTypeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    error: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructive,
    },
  });
}
