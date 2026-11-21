import type { ComponentType } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from "react-native";
import type { MemberAvatarTint } from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import {
  TASK_PROOF_KIND_HINTS,
  TASK_PROOF_KIND_LABELS,
  TASK_PROOF_KINDS,
  type TaskProofKind,
} from "@repo/validation";
import {
  avatarRadius,
  fieldTypeRole,
  typeRole,
  useFrappTheme,
} from "@/lib/theme";
import { useChapterBranding } from "@/lib/chapter-branding";
import { initialsFor } from "@/lib/more/narrow";
import { MemberAvatar } from "@/components/member-avatar";
import { Segmented } from "@/components/segmented";
import { sheetFieldStyles } from "@/components/sheet-scaffold";

/**
 * The task form's controls, drawn by the New task sheet and by the task
 * screen's edit in place (#5514) from one set of styles, so the two can't
 * drift apart: the "+" points field, Proof, and the assignee row.
 */

/**
 * The points field: the accent "+" and a number-pad input, in a field's
 * frame. A sheet passes `BottomSheetTextInput` as `input`, which a sheet's
 * keyboard handling needs; a screen takes the plain `TextInput`.
 */
export function PointsField({
  input: Input = TextInput,
  focused = false,
  style,
  ...inputProps
}: Omit<TextInputProps, "style"> & {
  input?: ComponentType<TextInputProps>;
  /** Draws the field's focus border. */
  focused?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens, accent);
  return (
    <View style={[styles.field, focused ? styles.fieldFocused : null, style]}>
      <Text style={[styles.pointsSign, { color: accent }]}>+</Text>
      <Input
        placeholder="pts"
        placeholderTextColor={tokens.color.text.muted}
        accessibilityLabel="Point reward"
        keyboardType="number-pad"
        {...inputProps}
        style={styles.pointsInput}
      />
    </View>
  );
}

/** What Mark done needs (#4635): None, Photo or Link, and what it means. */
export function ProofField({
  value,
  onChange,
  disabled = false,
}: {
  value: TaskProofKind;
  onChange: (next: TaskProofKind) => void;
  disabled?: boolean;
}) {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens, accent);
  return (
    <View style={styles.group}>
      <Text style={styles.groupLabel}>Proof</Text>
      <Segmented
        options={TASK_PROOF_KINDS.map((kind) => ({
          value: kind,
          label: TASK_PROOF_KIND_LABELS[kind],
        }))}
        value={value}
        onChange={onChange}
        accessibilityLabel="Proof to mark it done"
        disabled={disabled}
      />
      <Text style={styles.note}>{TASK_PROOF_KIND_HINTS[value]}</Text>
    </View>
  );
}

/**
 * Who the task is for: a face, the name, and "assignee", opening Assign
 * to's picker. The member's photo and tint where the caller has them, else
 * the initials on the neutral circle.
 */
export function AssigneeRow({
  label,
  name,
  avatarUri = null,
  tint = null,
  onPress,
  disabled = false,
}: {
  /** What the row says: a name, "You", or who a group task goes to. */
  label: string;
  /** Whose initials the face draws, or `null` for none. */
  name: string | null;
  avatarUri?: string | null;
  tint?: MemberAvatarTint | null;
  onPress: () => void;
  disabled?: boolean;
}) {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens, accent);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Assignee: ${label}`}
      accessibilityHint="Choose who this task is for."
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={styles.assigneeRow}
    >
      <MemberAvatar
        uri={avatarUri}
        initials={initialsFor(name)}
        size={AVATAR_SIZE}
        style={styles.avatar}
        textStyle={styles.avatarText}
        tint={tint}
      />
      <Text style={styles.fieldValue} numberOfLines={1}>
        {label}
      </Text>
      <Text style={styles.assigneeHint}>assignee</Text>
    </Pressable>
  );
}

/** The assignee's face, as the New task sheet has always drawn it. */
const AVATAR_SIZE = 26;

function createStyles(tokens: SignetTokens, accent: string) {
  const fieldStyles = sheetFieldStyles(tokens, accent);
  return StyleSheet.create({
    field: {
      ...fieldStyles.field,
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
    },
    fieldFocused: fieldStyles.fieldFocused,
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
    assigneeHint: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
    },
    avatar: {
      width: AVATAR_SIZE,
      height: AVATAR_SIZE,
      borderRadius: avatarRadius(AVATAR_SIZE),
      backgroundColor: tokens.color.surface.popover,
      alignItems: "center",
      justifyContent: "center",
    },
    avatarText: {
      // TODO-DESIGN: Canvas draws these initials at 10.5px/700; `caption` is
      // 12.5/400 and is the smallest role available.
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
  });
}
