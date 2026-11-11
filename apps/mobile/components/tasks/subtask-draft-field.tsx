import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { BottomSheetTextInput } from "@gorhom/bottom-sheet";
import Svg, { Path } from "react-native-svg";
import {
  TASK_SUBTASK_TITLE_MAX_LENGTH,
  TASK_SUBTASKS_MAX,
} from "@repo/validation";
import { SignetTokens } from "@repo/theme/signet";
import { fieldTypeRole, typeRole, useFrappTheme } from "@/lib/theme";

/**
 * The New task sheet's subtasks (#4003): the steps of a chore, typed one at
 * a time. It reads as one more quiet field ("Add a subtask") under "Add a
 * time", so a task with no steps costs nothing. Return adds the step and
 * keeps the keyboard up for the next, the way Apple Reminders' and Todoist's
 * subtask entry work. The half-typed step is the parent's state (`text`),
 * so the sheet sends it as the last step: tapping Create never drops a typed
 * step, even in the same tap that ends the editing. Each added step sits
 * above the field with an × to take it back.
 */
export function SubtaskDraftField({
  items,
  onChange,
  text,
  onTextChange,
  disabled,
  fieldStyle,
}: {
  items: string[];
  onChange: (next: string[]) => void;
  /** The step being typed, not yet added. */
  text: string;
  onTextChange: (next: string) => void;
  disabled: boolean;
  /** The sheet's own field box, so this one matches its neighbours. */
  fieldStyle: StyleProp<ViewStyle>;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const muted = tokens.color.text.mutedForeground;
  const full = items.length >= TASK_SUBTASKS_MAX;

  const commit = () => {
    const title = text.trim();
    if (!title || full) return;
    onChange([...items, title]);
    onTextChange("");
  };

  return (
    <View style={styles.section}>
      {items.map((item, index) => (
        <View key={`${index}-${item}`} style={styles.step}>
          <View style={styles.box} />
          <Text style={styles.stepText} numberOfLines={2}>
            {item}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Remove subtask: ${item}`}
            accessibilityState={{ disabled }}
            disabled={disabled}
            hitSlop={10}
            onPress={() => onChange(items.filter((_, i) => i !== index))}
            style={styles.remove}
          >
            <CrossGlyph color={muted} />
          </Pressable>
        </View>
      ))}
      {full ? (
        <Text style={styles.note}>
          {TASK_SUBTASKS_MAX} subtasks is the most a task can have.
        </Text>
      ) : (
        <View style={fieldStyle}>
          <ChecklistGlyph color={muted} />
          <BottomSheetTextInput
            value={text}
            onChangeText={onTextChange}
            editable={!disabled}
            placeholder={items.length === 0 ? "Add a subtask" : "Next step"}
            placeholderTextColor={tokens.color.text.muted}
            accessibilityLabel="Add a subtask"
            maxLength={TASK_SUBTASK_TITLE_MAX_LENGTH}
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={commit}
            onEndEditing={commit}
            style={styles.input}
          />
        </View>
      )}
    </View>
  );
}

/** Three short lines with a tick on the first: a checklist. */
function ChecklistGlyph({
  color,
  size = 17,
}: {
  color: string;
  size?: number;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M4 6.5l1.5 1.5L8 5.5M11 7h9M11 12h9M11 17h9M5 12h1M5 17h1"
        stroke={color}
        strokeWidth={1.7}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
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
    step: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
      minHeight: 36,
      paddingHorizontal: tokens.spacing.md,
    },
    box: {
      width: 15,
      height: 15,
      borderRadius: tokens.radius.chip,
      borderWidth: 1.5,
      borderColor: tokens.color.border.input,
    },
    stepText: {
      flex: 1,
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
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
    note: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
      paddingHorizontal: tokens.spacing.md,
    },
  });
}
