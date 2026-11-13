import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  ACTIVITY_WEEK_HINT,
  type ActivityAgenda,
  type ActivityAgendaFilter,
  type ActivityRow,
  type ActivityWeekLine,
  type ActivityWeekSummary,
} from "@repo/hooks";
import type { SignetTokens } from "@repo/theme/signet";
import { eyebrowStyle } from "@/components/eyebrow";
import { meterStyles } from "@/components/meter";
import { SkeletonBlock, SkeletonText } from "@/components/state-block";
import { CheckGlyph } from "@/components/tasks/task-glyphs";
import { useChapterBranding } from "@/lib/chapter-branding";
import { pageSurfaces } from "@/lib/surfaces";
import { typeRole, useFrappTheme } from "@/lib/theme";
import {
  ActivityRowItem,
  type ActivityRowActions,
} from "./activity-row-action";
import { ProgressRing } from "./progress-ring";

/** The week ring: big enough to hold "12" over "of 24" at the type scale. */
const RING_SIZE = 88;
const RING_STROKE = 9;

/**
 * The top of the phone's Activity (#4766): one ring, done of total this week,
 * where five count tiles were (Paul, 2026-11-13: "too many little cards that
 * tell me no information", "maybe a percentage or like a dial"). Apple
 * Fitness's rings and Bevel's daily dial are the comparables: one figure that
 * closes as the work is done, with the parts named beside it.
 *
 * Beside the ring, a line per kind that has anything this week. A line is a
 * control: pressing it narrows the To do list to that kind, and pressing it
 * again shows everything. Under them, the one thing to do next, whose ask is
 * the one filled button on the screen.
 *
 * - Nothing due: the ring steps back to its groove and a quiet check, and the
 *   card says so. Never "0 of 0".
 * - Everything done: the ring closes in the success hue.
 * - A part couldn't load: its line draws a dash, the headline says "at
 *   least", and the card says which part. A failed read is never a zero.
 * - An API from before the week (`summary.state` is `unknown`): no ring, only
 *   the next thing.
 */
export function WeekCard({
  summary,
  next,
  nextLabel,
  filter,
  onFilter,
  rowActions = null,
  onOpenNext,
}: {
  summary: ActivityWeekSummary;
  next: ActivityRow | null;
  nextLabel: ActivityAgenda["nextLabel"];
  filter: ActivityAgendaFilter;
  onFilter: (filter: ActivityAgendaFilter) => void;
  /**
   * The Next row's ask as a button when it is one press (#4427: Check in on
   * an event happening now), as the To do rows carry it.
   */
  rowActions?: ActivityRowActions | null;
  onOpenNext: (row: ActivityRow) => void;
}) {
  const { tokens } = useFrappTheme();
  const { accent, accentPrimary } = useChapterBranding();
  const styles = createStyles(tokens);
  const known = summary.state !== "unknown";
  if (!known && !next) return null;
  const closed = summary.state === "done";
  const success = tokens.color.semantic.success;
  return (
    <View style={styles.card} testID="activity-week-card">
      {known ? (
        <View style={styles.top}>
          <View
            accessible
            accessibilityRole="text"
            accessibilityLabel={summary.spokenLabel}
          >
            <ProgressRing
              size={RING_SIZE}
              stroke={RING_STROKE}
              progress={summary.progress}
              color={closed ? success : accentPrimary}
              testID="activity-week-ring"
            >
              {summary.total > 0 ? (
                <>
                  <Text style={styles.ringDone}>{summary.done}</Text>
                  <Text style={styles.ringTotal}>{`of ${summary.total}`}</Text>
                </>
              ) : summary.incomplete ? (
                <Text style={styles.ringDash}>–</Text>
              ) : (
                <CheckGlyph color={tokens.color.text.muted} size={26} />
              )}
            </ProgressRing>
          </View>
          <View style={styles.legend}>
            <Text
              accessibilityRole="header"
              style={[styles.headline, closed ? { color: success } : null]}
            >
              {summary.headline}
            </Text>
            {summary.lines.length > 0 ? (
              <View style={styles.lines}>
                {summary.lines.map((line) => (
                  <WeekLine
                    key={line.id}
                    line={line}
                    selected={filter === line.id}
                    onPress={() =>
                      onFilter(filter === line.id ? "all" : line.id)
                    }
                  />
                ))}
              </View>
            ) : summary.incomplete ? null : (
              <Text style={styles.quiet}>{ACTIVITY_WEEK_HINT}</Text>
            )}
          </View>
        </View>
      ) : null}
      {known && summary.warning ? (
        <Text style={styles.warning}>
          {`${summary.warning} Pull down to try again.`}
        </Text>
      ) : null}
      {next ? (
        <View style={known ? styles.next : null}>
          <Text
            style={[
              styles.eyebrow,
              nextLabel === "Happening now" ? { color: accent } : null,
            ]}
          >
            {nextLabel}
          </Text>
          <ActivityRowItem
            row={next}
            isFirst
            actions={rowActions}
            onCard
            solo
            onPress={() => onOpenNext(next)}
          />
        </View>
      ) : null}
    </View>
  );
}

/** One line beside the ring: a kind, how far along it is, and its count. */
function WeekLine({
  line,
  selected,
  onPress,
}: {
  line: ActivityWeekLine;
  selected: boolean;
  onPress: () => void;
}) {
  const { tokens } = useFrappTheme();
  const { accent, accentPrimary } = useChapterBranding();
  const styles = createStyles(tokens);
  const progress =
    line.done === null || line.total === null || line.total === 0
      ? 0
      : Math.min(1, line.done / line.total);
  const closed = line.total !== null && line.total > 0 && progress === 1;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={line.spokenLabel}
      accessibilityState={{ selected }}
      accessibilityHint={
        selected
          ? "Shows everything in the list again."
          : `Shows only ${line.label.toLowerCase()} in the list.`
      }
      // The lines sit closer than the touch floor; the slop shares the gap.
      hitSlop={{ top: LINE_SLOP, bottom: LINE_SLOP, left: 8, right: 8 }}
      onPress={onPress}
      testID={`activity-week-line-${line.id}`}
      style={({ pressed }) => [styles.line, pressed ? styles.pressed : null]}
    >
      <Text
        numberOfLines={1}
        style={[styles.lineLabel, selected ? { color: accent } : null]}
      >
        {line.label}
      </Text>
      <View style={styles.lineTrack}>
        <View
          style={[
            styles.lineFill,
            {
              width: `${Math.round(progress * 100)}%`,
              backgroundColor: closed
                ? tokens.color.semantic.success
                : accentPrimary,
            },
          ]}
        />
      </View>
      <Text style={[styles.lineCount, selected ? { color: accent } : null]}>
        {line.done === null ? "–" : `${line.done} of ${line.total}`}
      </Text>
    </Pressable>
  );
}

/** The card before the first read, on the loaded card's frame. */
export function WeekCardSkeleton() {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const { caption, title } = tokens.typography.role;
  return (
    <View style={styles.card}>
      <View style={styles.top}>
        <SkeletonBlock
          width={RING_SIZE}
          height={RING_SIZE}
          radius={RING_SIZE / 2}
        />
        <View style={styles.legend}>
          <SkeletonText role={title} width="72%" />
          <View style={styles.lines}>
            <View style={styles.line}>
              <SkeletonText role={caption} width="90%" />
            </View>
            <View style={styles.line}>
              <SkeletonText role={caption} width="78%" />
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}

/** A line's height, and the slop that brings its hit area toward the floor. */
const LINE_HEIGHT = 28;
const LINE_SLOP = 4;

function createStyles(tokens: SignetTokens) {
  const surfaces = pageSurfaces(tokens);
  const meter = meterStyles(tokens);
  return StyleSheet.create({
    card: {
      borderRadius: tokens.radius.card,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: surfaces.card,
      paddingHorizontal: tokens.spacing.lg,
      paddingVertical: tokens.spacing.md,
      gap: tokens.spacing.sm,
    },
    top: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
      paddingVertical: tokens.spacing.xs,
    },
    ringDone: {
      ...typeRole(tokens.typography.role.headline),
      // Leading 1: the figure and its "of N" sit as one block in the ring.
      lineHeight: tokens.typography.role.headline.size,
      fontVariant: ["tabular-nums"],
      color: tokens.color.text.foreground,
    },
    ringTotal: {
      ...typeRole(tokens.typography.role.caption),
      fontVariant: ["tabular-nums"],
      color: tokens.color.text.mutedForeground,
    },
    ringDash: {
      ...typeRole(tokens.typography.role.headline),
      color: tokens.color.text.mutedForeground,
    },
    legend: {
      flex: 1,
      minWidth: 0,
      gap: tokens.spacing.xs,
    },
    eyebrow: {
      ...eyebrowStyle(tokens),
      color: tokens.color.text.mutedForeground,
    },
    headline: {
      ...typeRole(tokens.typography.role.title),
      color: tokens.color.text.foreground,
    },
    quiet: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    warning: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.warning,
    },
    lines: {
      marginTop: tokens.spacing.xs,
    },
    line: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
      height: LINE_HEIGHT,
    },
    pressed: { opacity: 0.7 },
    // One column each, so every line's bar starts and ends on the same
    // edges whatever its label and count say.
    lineLabel: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.foreground,
      flexGrow: 5,
      flexShrink: 1,
      flexBasis: 0,
    },
    lineTrack: {
      ...meter.track,
      flexGrow: 2,
      flexShrink: 1,
      flexBasis: 0,
    },
    lineFill: meter.fill,
    lineCount: {
      ...typeRole({
        ...tokens.typography.role.caption,
        weight: tokens.typography.weight.semibold,
      }),
      fontVariant: ["tabular-nums"],
      color: tokens.color.text.mutedForeground,
      minWidth: 54,
      textAlign: "right",
    },
    next: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: tokens.color.border.hairline,
      paddingTop: tokens.spacing.md,
    },
  });
}
