import { StyleSheet, Text, View } from "react-native";
import { SignetTokens } from "@repo/theme/signet";
import { typeRole, useFrappTheme } from "@/lib/theme";
import type { HouseRank, PointsSummary } from "@/lib/tasks/points-card";

/**
 * The balance + house-rank card at the top of s08 —
 * `canvas-screens.dc.html:282-288`.
 *
 * This is the landed replacement for the deleted `points.tsx` /
 * `points-details.tsx` routes, which `spec/ui/mobile/screens.md` records as
 * re-landing here as stat cards.
 *
 * Either half renders an em dash when its query has not resolved or the viewer
 * has no standing to report. That is the `hasEntries` discipline
 * `app/(tabs)/service-hours.tsx` states: a "0" headlined at a member who has
 * 1,240 points is worse than saying nothing yet. A *real* zero still renders 0 —
 * `selectPointsSummary` keeps the two apart.
 */

export interface PointsSummaryCardProps {
  summary: PointsSummary | null;
  rank: HouseRank | null;
}

export function PointsSummaryCard({ summary, rank }: PointsSummaryCardProps) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);

  return (
    <View style={styles.card}>
      <View style={styles.balanceColumn}>
        <Text style={styles.label}>Semester points</Text>
        <Text
          style={styles.balance}
          accessibilityLabel={
            summary
              ? `${summary.balance} semester points`
              : "Semester points not available yet"
          }
        >
          {summary ? summary.balance.toLocaleString() : "—"}
        </Text>
      </View>

      <View style={styles.rankColumn}>
        <Text style={styles.label}>House rank</Text>
        {rank ? (
          <Text
            style={styles.rank}
            accessibilityLabel={`Ranked ${rank.rank} of ${rank.of}`}
          >
            {`#${rank.rank}`}
            <Text style={styles.rankOf}>{` of ${rank.of}`}</Text>
          </Text>
        ) : (
          <Text style={styles.rank}>—</Text>
        )}
      </View>
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    card: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.lg,
      borderRadius: tokens.radius.cardLarge,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.card,
      padding: tokens.spacing.lg,
    },
    balanceColumn: {
      flex: 1,
    },
    rankColumn: {
      alignItems: "flex-end",
    },
    label: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    balance: {
      // TODO-DESIGN: Canvas draws 30px/700; `display` is 32/700 and arithmetic
      // on a role token is banned by foundations.md §7, so the nearest role wins.
      ...typeRole(tokens.typography.role.display),
      letterSpacing: -0.5,
      color: tokens.color.gold.askText,
      marginTop: 2,
    },
    rank: {
      // TODO-DESIGN: Canvas draws 17px/700; `title` is 18/600.
      ...typeRole(tokens.typography.role.title),
      color: tokens.color.text.foreground,
      marginTop: 6,
    },
    rankOf: {
      ...typeRole(tokens.typography.role.title),
      color: tokens.color.text.muted,
    },
  });
}
