import { StyleSheet, Text, View } from "react-native";
import { SignetTokens } from "@repo/theme/signet";
import { typeRole, useFrappTheme } from "@/lib/theme";
import { formatHoursValue } from "@/lib/study/format";

/**
 * The THIS WEEK line — `canvas-screens.dc.html`, `id="s10"`.
 *
 * ## Why there is no progress bar
 *
 * TODO-DESIGN: Canvas draws `5.4 of 6.0 hrs` over a 90%-filled meter. **There is
 * no weekly study requirement anywhere in the schema** — `study_geofences`
 * carries `minutes_per_point`, `points_per_interval`, `min_session_minutes` and
 * `pause_grace_minutes`, and nothing else in the model expresses a target. A bar
 * needs a denominator, and inventing one would dress a made-up number as a
 * chapter rule, which `spec/ui/mobile/screens.md` bans outright ("Elements drawn
 * in Canvas that have no backing data are omitted, not faked"). The same
 * fictional `6.0` appears on s08, s09 and s14, so it is one missing field behind
 * four surfaces — filed as one issue rather than four.
 *
 * Nearest pattern used: the week's real total, with the session count as the
 * secondary fact the meter was carrying.
 */
export interface WeekSummaryProps {
  minutes: number;
  sessionCount: number;
}

export function WeekSummary({ minutes, sessionCount }: WeekSummaryProps) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const hours = formatHoursValue(minutes);

  return (
    <View style={styles.row}>
      <Text style={styles.label}>THIS WEEK</Text>
      <Text
        style={styles.value}
        accessibilityLabel={`${hours} hours this week across ${sessionCount} ${
          sessionCount === 1 ? "session" : "sessions"
        }`}
      >
        <Text style={styles.valueStrong}>{hours}</Text>
        {` hrs · ${sessionCount} ${sessionCount === 1 ? "session" : "sessions"}`}
      </Text>
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "baseline",
      justifyContent: "space-between",
      gap: tokens.spacing.sm,
    },
    label: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
      letterSpacing: 0.6,
    },
    value: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.mutedForeground,
    },
    valueStrong: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
  });
}
