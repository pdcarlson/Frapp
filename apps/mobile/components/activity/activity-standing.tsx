import { StyleSheet, Text, View } from "react-native";
import {
  activityStandingRows,
  type ActivityStanding as Standing,
  type StandingRow,
} from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import { PressableRow, SectionHeader } from "@/components/list-section";
import { meterStyles } from "@/components/meter";
import { SkeletonText } from "@/components/state-block";
import { useChapterBranding } from "@/lib/chapter-branding";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * Where each row goes: the screen that owns the number. Points and rank
 * live at the top of Tasks (s08); attendance is on Events.
 */
export type StandingDestination =
  "/tasks" | "/events" | "/service-hours" | "/study";

const DESTINATION: Record<StandingRow["id"], StandingDestination> = {
  points: "/tasks",
  required_events: "/events",
  service: "/service-hours",
  study: "/study",
};

/**
 * "This semester" at the top of the phone's Activity (Evan, 2026-11-12: a
 * dashboard with "progress bars and stuff"): the member's points and place,
 * the required events they made, their service hours and this week's study
 * time, one row each in one card, from `GET /v1/activity/standing`. Web's
 * `ActivityStanding` on the phone.
 *
 * A row opens the screen that owns its number. A row draws a meter only when
 * it has a target: required events always (the events themselves), and
 * points or hours when the chapter sets the member a goal in Chapter settings
 * (#1062). A bar with an invented end would read as a rule.
 * The meter is the poll card's (`components/meter.ts`): accent on a
 * `--background` groove, inside a card so the groove recedes, and never the
 * only signal, since the row says "6 of 8" in words.
 */
export function ActivityStanding({
  standing,
  onOpen,
}: {
  standing: Standing;
  onOpen: (destination: StandingDestination) => void;
}) {
  const { tokens } = useFrappTheme();
  const { accentPrimary } = useChapterBranding();
  const styles = createStyles(tokens);
  const rows = activityStandingRows(standing);
  if (rows.length === 0) return null;
  return (
    <View style={styles.block}>
      <SectionHeader>This semester</SectionHeader>
      <View style={styles.card}>
        {rows.map((row, index) => (
          <PressableRow
            key={row.id}
            accessibilityRole="button"
            accessibilityLabel={row.spokenLabel}
            accessibilityHint={`Opens ${HINT[row.id]}.`}
            onPress={() => onOpen(DESTINATION[row.id])}
            onCard
            testID={`activity-standing-${row.id}`}
            style={[styles.row, index > 0 ? styles.rowDivided : null]}
          >
            <View style={styles.line}>
              <Text numberOfLines={1} style={styles.label}>
                {row.label}
              </Text>
              <Text numberOfLines={1} style={styles.trailing}>
                {row.detail ? (
                  <Text style={styles.detail}>{`${row.detail}  `}</Text>
                ) : null}
                <Text style={row.value === null ? styles.detail : styles.value}>
                  {row.value ?? "–"}
                </Text>
              </Text>
            </View>
            {row.progress !== null ? (
              <View style={styles.meterTrack}>
                <View
                  style={[
                    styles.meterFill,
                    {
                      width: `${Math.round(Math.min(1, Math.max(0, row.progress)) * 100)}%`,
                      backgroundColor: accentPrimary,
                    },
                  ]}
                />
              </View>
            ) : null}
          </PressableRow>
        ))}
      </View>
    </View>
  );
}

const HINT: Record<StandingRow["id"], string> = {
  points: "Tasks, where your points and rank are",
  required_events: "Events",
  service: "Service hours",
  study: "Study hours",
};

/** The block before the first read: its heading and four quiet lines. */
export function ActivityStandingSkeleton() {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  return (
    <View style={styles.block}>
      <SectionHeader>This semester</SectionHeader>
      <View style={styles.card}>
        {[0, 1, 2, 3].map((index) => (
          <View
            key={index}
            style={[styles.row, index > 0 ? styles.rowDivided : null]}
          >
            <SkeletonText
              role={tokens.typography.role.label}
              width={index % 2 === 0 ? "38%" : "46%"}
            />
          </View>
        ))}
      </View>
    </View>
  );
}

/** One row: the touch floor, and room for its meter under the line. */
const ROW_MIN_HEIGHT = 44;

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    block: {
      gap: tokens.spacing.sm,
    },
    card: {
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.card,
      overflow: "hidden",
    },
    row: {
      minHeight: ROW_MIN_HEIGHT,
      justifyContent: "center",
      gap: tokens.spacing.xs,
      paddingHorizontal: tokens.spacing.md,
      paddingVertical: tokens.spacing.sm,
    },
    rowDivided: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: tokens.color.border.hairline,
    },
    line: {
      flexDirection: "row",
      alignItems: "baseline",
      justifyContent: "space-between",
      gap: tokens.spacing.sm,
    },
    label: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
      flexShrink: 1,
    },
    trailing: {
      flexShrink: 0,
    },
    value: {
      ...typeRole({
        ...tokens.typography.role.label,
        weight: tokens.typography.weight.semibold,
      }),
      fontVariant: ["tabular-nums"],
      color: tokens.color.text.foreground,
    },
    detail: {
      ...typeRole(tokens.typography.role.caption),
      fontVariant: ["tabular-nums"],
      color: tokens.color.text.mutedForeground,
    },
    meterTrack: meterStyles(tokens).track,
    meterFill: meterStyles(tokens).fill,
  });
}
