import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
} from "react-native";
import { useMinutesDraftClock } from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import {
  MINUTES_FLOW_COPY,
  minutesDraftSteps,
  type MinutesDraftSource,
} from "@repo/validation";
import { CheckGlyph } from "@/components/control-glyphs";
import { useChapterBranding } from "@/lib/chapter-branding";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * What a draft being written shows (Paul, 2026-11-19: "Nothing indicates
 * it's processing"), web's `DraftingSteps` in `notes-draft-panel.tsx` in the
 * same words: what is done, what is under way and for how long, and that the
 * officer may leave. The recorder's own four steps stand in for this while a
 * recording is what the draft reads (`RecorderStage`).
 */
export function DraftingSteps({
  source,
  requestedAt,
}: {
  source: MinutesDraftSource;
  requestedAt: string | null;
}) {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens);
  const clock = useMinutesDraftClock(requestedAt);
  return (
    <View style={styles.card}>
      {minutesDraftSteps(source).map((step) => (
        <View key={step.label} style={styles.step}>
          <View style={styles.mark}>
            {step.state === "done" ? (
              <View style={[styles.doneDot, { backgroundColor: accent }]}>
                <CheckGlyph color={tokens.color.surface.background} size={14} />
              </View>
            ) : step.state === "now" ? (
              <ActivityIndicator size="small" color={accent} />
            ) : (
              <View style={styles.waitDot} />
            )}
          </View>
          <Text
            style={[
              styles.label,
              step.state === "next" ? styles.waiting : null,
              step.state === "now" ? styles.now : null,
            ]}
            // Web's words for each step's state.
            accessibilityLabel={
              step.state === "done"
                ? `${step.label}, done`
                : step.state === "now"
                  ? `${step.label}, under way`
                  : step.label
            }
          >
            {step.label}
          </Text>
          {step.state === "now" && clock ? (
            <Text style={styles.clock}>{clock}</Text>
          ) : null}
        </View>
      ))}
      <Text accessibilityLiveRegion="polite" style={styles.leave}>
        {MINUTES_FLOW_COPY.drafting.leave}
      </Text>
    </View>
  );
}

/**
 * "Drafting · 1:05" on the bar at the bottom of the screen. Its own component
 * so the clock's tick redraws this line, not the whole minutes screen.
 */
export function DraftingClockLine({
  requestedAt,
  style,
}: {
  requestedAt: string | null;
  style: StyleProp<TextStyle>;
}) {
  const clock = useMinutesDraftClock(requestedAt);
  return (
    <Text accessibilityLiveRegion="polite" style={style}>
      {clock
        ? `${MINUTES_FLOW_COPY.drafting.badge} · ${clock}`
        : MINUTES_FLOW_COPY.drafting.badge}
    </Text>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    card: {
      gap: tokens.spacing.md,
      padding: tokens.spacing.md,
      borderRadius: tokens.radius.card,
      backgroundColor: tokens.color.surface.card,
    },
    step: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
      minHeight: 24,
    },
    mark: {
      width: 24,
      alignItems: "center",
    },
    doneDot: {
      width: 22,
      height: 22,
      borderRadius: 11,
      alignItems: "center",
      justifyContent: "center",
    },
    waitDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
      borderWidth: 1.5,
      borderColor: tokens.color.border.input,
    },
    label: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
      flexShrink: 1,
    },
    now: {
      fontWeight: "600",
    },
    waiting: {
      color: tokens.color.text.mutedForeground,
    },
    clock: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
      fontVariant: ["tabular-nums"],
    },
    leave: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
  });
}
