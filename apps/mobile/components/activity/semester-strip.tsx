import { StyleSheet, Text, View } from "react-native";
import {
  activityStandingGauges,
  type ActivityStanding,
  type StandingRow,
} from "@repo/hooks";
import type { SignetTokens } from "@repo/theme/signet";
import { PressableRow, SectionHeader } from "@/components/list-section";
import { SkeletonBlock, SkeletonText } from "@/components/state-block";
import { useChapterBranding } from "@/lib/chapter-branding";
import { pageSurfaces } from "@/lib/surfaces";
import { typeRole, useFrappTheme } from "@/lib/theme";
import { ProgressRing } from "./progress-ring";

/**
 * Where each gauge goes: the screen that owns the number. Points and rank
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

const HINT: Record<StandingRow["id"], string> = {
  points: "Tasks, where your points and rank are",
  required_events: "Events",
  service: "Service hours",
  study: "Study hours",
};

/** A gauge's ring: the week ring's recipe, small enough to lead a line. */
const GAUGE_SIZE = 36;
const GAUGE_STROKE = 5;

/**
 * "This semester" under the week card (#4766): the member's points, required
 * events, service hours and study time as up to four gauges in one card, two
 * across, from `GET /v1/activity/standing`, where a four-row card of bars
 * was. The ring says the week; this says the long run.
 *
 * Two across, not four: at a phone's width four across cut "3h 57m of 4h"
 * short, and the app writes hours that way everywhere else. An odd gauge out
 * takes the full row.
 *
 * A gauge draws a ring only when its number has a target (required events
 * always; points and hours when the chapter sets the member a goal, #1062):
 * a ring with an invented end would read as a rule. Without one the number
 * stands alone. A number that is zero with nothing to aim at is left out
 * (`activityStandingGauges`), which is the zero tile's fix (#4679), and with
 * none left the strip isn't drawn. Each gauge opens the screen that owns its
 * number.
 */
export function SemesterStrip({
  standing,
  onOpen,
}: {
  standing: ActivityStanding;
  onOpen: (destination: StandingDestination) => void;
}) {
  const { tokens } = useFrappTheme();
  const { accentPrimary } = useChapterBranding();
  const styles = createStyles(tokens);
  const gauges = activityStandingGauges(standing);
  if (gauges.length === 0) return null;
  return (
    <View style={styles.block}>
      <SectionHeader>This semester</SectionHeader>
      <View style={styles.card}>
        {gauges.map((gauge, index) => (
          <View
            key={gauge.id}
            style={[
              styles.cell,
              index % 2 === 1 ? styles.cellDividedLeft : null,
              index >= 2 ? styles.cellDividedTop : null,
            ]}
          >
            <PressableRow
              accessibilityRole="button"
              accessibilityLabel={gauge.spokenLabel}
              accessibilityHint={`Opens ${HINT[gauge.id]}.`}
              onPress={() => onOpen(DESTINATION[gauge.id])}
              onCard
              testID={`activity-standing-${gauge.id}`}
              style={styles.gauge}
            >
              {gauge.progress !== null ? (
                <ProgressRing
                  size={GAUGE_SIZE}
                  stroke={GAUGE_STROKE}
                  progress={gauge.progress}
                  color={
                    gauge.progress >= 1
                      ? tokens.color.semantic.success
                      : accentPrimary
                  }
                  testID={`activity-gauge-ring-${gauge.id}`}
                />
              ) : null}
              <View style={styles.text}>
                <Text numberOfLines={1} style={styles.target}>
                  <Text
                    style={
                      gauge.figure === null ? styles.missing : styles.figure
                    }
                  >
                    {gauge.figure ?? "–"}
                  </Text>
                  {gauge.target ? ` ${gauge.target}` : null}
                </Text>
                <Text numberOfLines={1} style={styles.label}>
                  {gauge.shortLabel}
                  {gauge.detail ? (
                    <Text style={styles.detail}>{` · ${gauge.detail}`}</Text>
                  ) : null}
                </Text>
              </View>
            </PressableRow>
          </View>
        ))}
      </View>
    </View>
  );
}

/** The strip before the first read: its heading and four quiet gauges. */
export function SemesterStripSkeleton() {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const { caption, label } = tokens.typography.role;
  return (
    <View style={styles.block}>
      <SectionHeader>This semester</SectionHeader>
      <View style={styles.card}>
        {[0, 1, 2, 3].map((index) => (
          <View
            key={index}
            style={[
              styles.cell,
              index % 2 === 1 ? styles.cellDividedLeft : null,
              index >= 2 ? styles.cellDividedTop : null,
            ]}
          >
            <View style={styles.gauge}>
              <SkeletonBlock
                width={GAUGE_SIZE}
                height={GAUGE_SIZE}
                radius={GAUGE_SIZE / 2}
              />
              <View style={styles.text}>
                <SkeletonText role={label} width="70%" />
                <SkeletonText role={caption} width="52%" />
              </View>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  const surfaces = pageSurfaces(tokens);
  return StyleSheet.create({
    block: {
      gap: tokens.spacing.sm,
    },
    card: {
      flexDirection: "row",
      flexWrap: "wrap",
      borderRadius: tokens.radius.card,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: surfaces.card,
      overflow: "hidden",
    },
    // Two across; the last of an odd count grows to the full row.
    cell: {
      flexBasis: "50%",
      flexGrow: 1,
      minWidth: 0,
    },
    cellDividedLeft: {
      borderLeftWidth: StyleSheet.hairlineWidth,
      borderLeftColor: tokens.color.border.hairline,
    },
    cellDividedTop: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: tokens.color.border.hairline,
    },
    gauge: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
      minHeight: tokens.touch.minimum,
      paddingHorizontal: tokens.spacing.md,
      paddingVertical: tokens.spacing.md,
    },
    text: {
      flex: 1,
      minWidth: 0,
      gap: 2,
    },
    target: {
      ...typeRole(tokens.typography.role.caption),
      fontVariant: ["tabular-nums"],
      color: tokens.color.text.mutedForeground,
    },
    figure: {
      ...typeRole(tokens.typography.role.label),
      fontVariant: ["tabular-nums"],
      color: tokens.color.text.foreground,
    },
    missing: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.mutedForeground,
    },
    label: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.foreground,
    },
    detail: {
      color: tokens.color.text.mutedForeground,
    },
  });
}
