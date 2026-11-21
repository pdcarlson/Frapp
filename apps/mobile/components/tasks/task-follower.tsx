import { useRef } from "react";
import { Keyboard, Pressable, StyleSheet, Text, View } from "react-native";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import {
  followerLabel,
  type FollowerChoice,
} from "@repo/hooks/task-follower-choices";
import { SignetTokens } from "@repo/theme/signet";
import { TASK_FOLLOWER_COPY } from "@repo/validation";
import { DisclosureGlyph } from "@/components/control-glyphs";
import { OptionSheet } from "@/components/option-sheet";
import { sheetFieldStyles } from "@/components/sheet-scaffold";
import { useChapterBranding } from "@/lib/chapter-branding";
import { typeRole, useFrappTheme } from "@/lib/theme";
import { followerOptions } from "@/lib/tasks/follower";

/**
 * From (#5473; Shawn, 2026-11-18): "Just you", or a tier, role or group the
 * officer is in, so everyone in it can see the task and how it's going while
 * officers still confirm it. A field row that opens a pick-one sheet split
 * into Tiers, Roles and Groups with their counts. Asana
 * and Linear let a team follow a task the same way, and Slack's user groups
 * sit above their people.
 *
 * A repeating task can't be from a group yet, so the row steps aside for
 * the reason. Nothing shows when the officer is in nothing and the task is
 * from nobody.
 */
export function FollowerField({
  value,
  currentName = null,
  choices,
  onChange,
  disabled = false,
  repeating = false,
}: {
  /** The entry it is from, or `null` for just its creator. */
  value: string | null;
  /** The task read's name for `value`, when the officer isn't in it. */
  currentName?: string | null;
  choices: readonly FollowerChoice[];
  onChange: (entry: string | null) => void;
  disabled?: boolean;
  /** The task repeats: no From yet, and the row says why. */
  repeating?: boolean;
}) {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens, accent);
  const sheetRef = useRef<BottomSheetModal>(null);
  if (choices.length === 0 && !value) return null;
  if (repeating) {
    return <Text style={styles.note}>{TASK_FOLLOWER_COPY.noRepeat}</Text>;
  }
  const label = followerLabel(choices, value, currentName);
  return (
    <View style={styles.group}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${TASK_FOLLOWER_COPY.field}: ${label}`}
        accessibilityHint="Choose a tier, role or group this task is from."
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={() => {
          Keyboard.dismiss();
          sheetRef.current?.present();
        }}
        style={styles.row}
      >
        <Text style={styles.label}>{TASK_FOLLOWER_COPY.field}</Text>
        <Text style={styles.value} numberOfLines={1}>
          {label}
        </Text>
        <DisclosureGlyph
          color={tokens.color.text.mutedForeground}
          size={16}
          direction="right"
        />
      </Pressable>
      {value ? (
        <Text style={styles.note}>{TASK_FOLLOWER_COPY.hint(label)}</Text>
      ) : null}
      <OptionSheet
        ref={sheetRef}
        title={TASK_FOLLOWER_COPY.field}
        options={followerOptions(choices, value, currentName)}
        selected={value}
        onSelect={(next) => {
          if (next !== value) onChange(next);
        }}
      />
    </View>
  );
}

function createStyles(tokens: SignetTokens, accent: string) {
  const fieldStyles = sheetFieldStyles(tokens, accent);
  return StyleSheet.create({
    group: {
      gap: tokens.spacing.xs,
    },
    row: {
      ...fieldStyles.field,
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
    },
    label: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
    },
    value: {
      flex: 1,
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    note: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
  });
}
