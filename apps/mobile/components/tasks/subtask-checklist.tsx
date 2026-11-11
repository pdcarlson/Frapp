import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSetSubtaskDone } from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import { tint, typeRole, useFrappTheme } from "@/lib/theme";
import { CheckGlyph } from "@/components/tasks/task-glyphs";
import type { TaskRowSubtask } from "@/lib/tasks/board";

/**
 * A task's subtasks in its detail sheet (#4003): the steps of the chore,
 * each a row the assignee taps to check off, like a checklist in Apple
 * Reminders. The tap flips the box at once (`useSetSubtaskDone` writes the
 * cache first) and a refusal puts it back. `readOnly` once the task is
 * confirmed: its points are paid and the API keeps its steps where they are.
 */
export function SubtaskChecklist({
  taskId,
  subtasks,
  readOnly,
}: {
  taskId: string;
  subtasks: TaskRowSubtask[];
  readOnly: boolean;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const setDone = useSetSubtaskDone();
  const done = subtasks.filter((subtask) => subtask.done).length;

  return (
    <View style={styles.section}>
      <Text style={styles.heading}>
        Subtasks · {done} of {subtasks.length}
      </Text>
      {subtasks.map((subtask) => (
        <Pressable
          key={subtask.id}
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
              <CheckGlyph color={tokens.color.text.mutedForeground} size={11} />
            ) : null}
          </View>
          <Text style={[styles.title, subtask.done ? styles.titleDone : null]}>
            {subtask.title}
          </Text>
        </Pressable>
      ))}
    </View>
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
    row: {
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
    title: {
      flex: 1,
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    titleDone: {
      color: tokens.color.text.mutedForeground,
      textDecorationLine: "line-through",
    },
  });
}
