import { StyleSheet, Text, View } from "react-native";
import { SignetTokens } from "@repo/theme/signet";
import { typeRole, useFrappTheme } from "@/lib/theme";
import { eyebrowStyle } from "@/components/eyebrow";
import { meterStyles } from "@/components/meter";
import { useChapterBranding } from "@/lib/chapter-branding";
import { formatHoursValue } from "@/lib/study/format";

/**
 * The THIS WEEK line — `canvas-screens.dc.html`, `id="s10"`.
 *
 * The board draws `5.4 of 6.0 hrs` over a meter. The `6.0` is the member's
 * weekly study goal, which officers set in Chapter settings → Service hours
 * (#1062, `chapter_goals`; one for everyone, or a different one for a role),
 * read here from the Activity standing (`study.goal_minutes`). With no goal
 * the line keeps the week's real total and session count and draws no meter:
 * a bar with an invented end would read as a chapter rule
 * (`spec/ui/mobile/screens.md`, "omitted, not faked").
 *
 * The meter is `components/meter.ts`'s, but this line sits on the screen
 * rather than in a card, so its groove is the card tint instead of
 * `--background`, which would vanish against the screen around it.
 */
export interface WeekSummaryProps {
  minutes: number;
  sessionCount: number;
  /** The member's weekly goal in minutes, or `null` when there is none. */
  goalMinutes?: number | null;
}

export function WeekSummary({
  minutes,
  sessionCount,
  goalMinutes = null,
}: WeekSummaryProps) {
  const { tokens } = useFrappTheme();
  const { accentPrimary } = useChapterBranding();
  const styles = createStyles(tokens);
  const hours = formatHoursValue(minutes);
  const sessions = `${sessionCount} ${sessionCount === 1 ? "session" : "sessions"}`;
  const hasGoal = goalMinutes !== null && goalMinutes > 0;
  const goal = hasGoal ? formatHoursValue(goalMinutes) : null;
  const progress = hasGoal
    ? Math.min(1, Math.max(0, minutes / goalMinutes))
    : 0;

  return (
    <View style={styles.block}>
      <View style={styles.row}>
        <Text style={styles.label}>This week</Text>
        <Text
          style={styles.value}
          accessibilityLabel={
            goal === null
              ? `${hours} hours this week across ${sessions}`
              : `${hours} of ${goal} study hours this week, across ${sessions}`
          }
        >
          <Text style={styles.valueStrong}>{hours}</Text>
          {goal === null
            ? ` hrs · ${sessions}`
            : ` of ${goal} hrs · ${sessions}`}
        </Text>
      </View>
      {hasGoal ? (
        <View
          style={styles.meterTrack}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          testID="week-summary-meter"
        >
          <View
            style={[
              styles.meterFill,
              {
                width: `${Math.round(progress * 100)}%`,
                backgroundColor: accentPrimary,
              },
            ]}
          />
        </View>
      ) : null}
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    block: {
      gap: tokens.spacing.sm,
    },
    row: {
      flexDirection: "row",
      alignItems: "baseline",
      justifyContent: "space-between",
      gap: tokens.spacing.sm,
    },
    label: {
      ...eyebrowStyle(tokens),
      color: tokens.color.text.muted,
    },
    value: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.mutedForeground,
    },
    valueStrong: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    meterTrack: {
      ...meterStyles(tokens).track,
      backgroundColor: tokens.color.surface.card,
    },
    meterFill: meterStyles(tokens).fill,
  });
}
