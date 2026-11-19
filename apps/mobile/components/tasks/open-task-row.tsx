import { Pressable, StyleSheet, Text, View } from "react-native";
import type { OpenTask } from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import { TASK_AUDIENCE_COPY } from "@repo/validation";
import { tint, typeRole, useFrappTheme } from "@/lib/theme";
import { useChapterBranding } from "@/lib/chapter-branding";
import { gutterBleed, PressableRow } from "@/components/list-section";
import { openTaskLine } from "@/lib/tasks/open-tasks";

/**
 * One task up for grabs on the Tasks screen (tasks.md § Up for grabs): the
 * title, "10 points · Philanthropy Committee · Due Friday", and a Claim pill.
 * Laid out as the board's own rows (`task-row.tsx`): flush, hairline-split,
 * the same height, so the section reads as part of the list and not a card
 * above it. The pill sits where a task's points chip sits.
 *
 * Claim is optimistic (`useClaimOpenTask`): the row leaves on the tap, so it
 * has no pending state of its own. A tap elsewhere pushes the posting's own
 * screen (`open-task-screen.tsx`, #5570; a sheet until then), where its
 * notes, steps and proof are read, and an officer hands it over or takes it
 * down. `onClaim` is left out where the viewer may not claim it (an
 * officer seeing a posting for another committee), and the row shows no pill.
 */
export function OpenTaskRow({
  posting,
  now,
  onClaim,
  onOpen,
  isFirst = false,
}: {
  posting: OpenTask;
  now: Date;
  onClaim?: () => void;
  onOpen: () => void;
  isFirst?: boolean;
}) {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens);
  const line = openTaskLine(posting, now);

  return (
    <PressableRow
      accessibilityRole="button"
      accessibilityLabel={line ? `${posting.title}, ${line}` : posting.title}
      accessibilityHint="Opens the task."
      accessibilityActions={
        onClaim
          ? [{ name: "claim", label: TASK_AUDIENCE_COPY.claim }]
          : undefined
      }
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === "claim") onClaim?.();
      }}
      onPress={onOpen}
      style={[styles.row, isFirst ? null : styles.rowDivider]}
    >
      <View style={styles.body}>
        <Text numberOfLines={2} style={styles.title}>
          {posting.title}
        </Text>
        {line ? <Text style={styles.subtitle}>{line}</Text> : null}
      </View>
      {onClaim ? (
        <Pressable
          // The row carries Claim as a named action for screen readers.
          accessible={false}
          importantForAccessibility="no-hide-descendants"
          testID={`claim-${posting.id}`}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          onPress={onClaim}
          style={({ pressed }) => [
            styles.pill,
            { backgroundColor: tint(accent, 0.16), borderColor: tint(accent, 0.3) },
            pressed ? styles.pressed : null,
          ]}
        >
          <Text style={[styles.pillLabel, { color: accent }]}>
            {TASK_AUDIENCE_COPY.claim}
          </Text>
        </Pressable>
      ) : null}
    </PressableRow>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
      paddingVertical: tokens.spacing.md,
      minHeight: tokens.touch.minimum,
      ...gutterBleed(tokens, { rounded: false }),
    },
    rowDivider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: tokens.color.border.hairline,
    },
    body: {
      flex: 1,
      gap: 2,
    },
    title: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    subtitle: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    pill: {
      minHeight: 30,
      paddingHorizontal: tokens.spacing.md,
      borderRadius: tokens.radius.chip,
      borderWidth: 1,
      alignItems: "center",
      justifyContent: "center",
    },
    pillLabel: {
      ...typeRole(tokens.typography.role.label),
    },
    pressed: {
      opacity: 0.7,
    },
  });
}
