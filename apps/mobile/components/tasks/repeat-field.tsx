import type { ComponentType } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type TextInputProps,
} from "react-native";
import Svg, { Path } from "react-native-svg";
import { SignetTokens } from "@repo/theme/signet";
import type { RepeatDraft } from "@repo/validation";
import { typeRole, useFrappTheme } from "@/lib/theme";
import { RepeatOptions } from "@/components/repeat-options";

/**
 * A task's Repeat (#5119): a quiet row under "Add a time", in a field's
 * frame like it, that opens the event sheet's Repeat control in place with
 * one more end, Never (`RepeatOptions` with `forTasks`). Closed, the row
 * says how the task repeats ("Every Monday"), or "Repeat" while it doesn't.
 * The New task sheet and the task screen's edit both draw it; what the pick
 * makes and when it saves is theirs. While it can't repeat (no due date,
 * #5761) the row says why in its place and doesn't open.
 */
export function TaskRepeatField({
  draft,
  first,
  summary,
  open,
  onOpenChange,
  onChange,
  disabled,
  fieldStyle,
  input,
  error,
  unavailable = null,
}: {
  draft: RepeatDraft;
  /** The task's due, which the control's defaults and caption read. */
  first: Date | null;
  /** What the closed row says once it repeats; `null` reads "Repeat". */
  summary: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (next: RepeatDraft) => void;
  disabled: boolean;
  /** The host's field frame, so the row lines up with "Add a time". */
  fieldStyle: object;
  /** `BottomSheetTextInput` in a sheet; the plain `TextInput` on a screen. */
  input?: ComponentType<TextInputProps>;
  /**
   * Why the pick can't be saved, shown under the control, or under the row
   * while it is closed, so a disabled Create always says why.
   */
  error?: string | null;
  /**
   * Why it can't repeat, said on the row in place of "Repeat" (#5761: "Add
   * a due date to repeat it"); the row is off and its options stay shut.
   */
  unavailable?: string | null;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const muted = tokens.color.text.mutedForeground;
  if (unavailable) {
    return (
      <View
        accessible
        accessibilityLabel={unavailable}
        accessibilityState={{ disabled: true }}
        style={fieldStyle}
      >
        <RepeatGlyph color={muted} />
        <Text style={styles.placeholder} numberOfLines={1}>
          {unavailable}
        </Text>
      </View>
    );
  }
  const label = summary ?? "Repeat";
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={summary ? `Repeats ${summary}` : "Repeat"}
        accessibilityHint={
          open ? "Hides the repeat options." : "Shows the repeat options."
        }
        accessibilityState={{ disabled, expanded: open }}
        disabled={disabled}
        onPress={() => onOpenChange(!open)}
        style={fieldStyle}
      >
        <RepeatGlyph color={muted} />
        <Text
          style={summary ? styles.value : styles.placeholder}
          numberOfLines={1}
        >
          {label}
        </Text>
      </Pressable>
      {open && first ? (
        <View style={styles.options}>
          <RepeatOptions
            forTasks
            draft={draft}
            start={first}
            onChange={onChange}
            disabled={disabled}
            error={error ?? undefined}
            showCaption={!draft.pristine}
            input={input}
          />
        </View>
      ) : error ? (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </>
  );
}

/** Two arrows chasing each other, the platforms' repeat mark. */
export function RepeatGlyph({
  color,
  size = 17,
}: {
  color: string;
  size?: number;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M17 2l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3"
        stroke={color}
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    placeholder: {
      flex: 1,
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.muted,
    },
    value: {
      flex: 1,
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    options: {
      gap: tokens.spacing.sm,
    },
    error: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructive,
    },
  });
}
