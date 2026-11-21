import { useRef, type RefObject } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { BottomSheetModal, BottomSheetView } from "@gorhom/bottom-sheet";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ACTIVITY_WEEK_HINT,
  type ActivityAgendaFilter,
  type ActivityWeekLine,
  type ActivityWeekSummary,
} from "@repo/hooks";
import type { SignetTokens } from "@repo/theme/signet";
import { meterStyles } from "@/components/meter";
import {
  SHEET_STACK_BEHAVIOR,
  SheetBackToClose,
  SheetGrabber,
  SheetHeader,
  SheetScrim,
  useSheetBackgroundStyle,
  useSheetClose,
} from "@/components/sheet-scaffold";
import { SkeletonBlock } from "@/components/state-block";
import { useChapterBranding } from "@/lib/chapter-branding";
import { pageSurfaces } from "@/lib/surfaces";
import { typeRole, useFrappTheme } from "@/lib/theme";
import { ProgressRing } from "./progress-ring";

/** The small ring: a glance, not a card (#5779). */
const RING_SIZE = 22;
const RING_STROKE = 3;

/**
 * The week on the phone's Activity, as a small ring on the title row (#5779,
 * Paul's pick 2026-11-20: "Small ring beside the title"), where the week card
 * with its 88pt ring and Next row was (#4766). Done of total this week
 * ("4/15"), from `activityWeekSummary`; web draws the same ring in its page
 * header (`apps/web/components/activity/week-ring.tsx`). Apple Fitness keeps
 * its rings this small in a summary, one press from the detail.
 *
 * Pressed, it opens a sheet with the per-kind lines. A line is a toggle: it
 * narrows the To do list to that kind and closes the sheet, and pressing it
 * again shows everything.
 *
 * - Nothing due: the ring is its groove and says "0", never "0/0".
 * - Everything done: the ring closes in the success hue.
 * - A part couldn't load: the lines draw a dash and the sheet says which part.
 * - An API from before the week (`summary.state` is `unknown`): no ring.
 */
export function WeekRing({
  summary,
  filter,
  onFilter,
}: {
  summary: ActivityWeekSummary;
  filter: ActivityAgendaFilter;
  onFilter: (filter: ActivityAgendaFilter) => void;
}) {
  const { tokens } = useFrappTheme();
  const { accent, accentPrimary } = useChapterBranding();
  const styles = createStyles(tokens);
  const sheet = useRef<BottomSheetModal>(null);
  if (summary.state === "unknown") return null;
  const closed = summary.state === "done";
  const narrowed = filter !== "all";
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={summary.spokenLabel || summary.headline}
        accessibilityHint="Shows this week by kind."
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        onPress={() => sheet.current?.present()}
        testID="activity-week-ring"
        style={({ pressed }) => [styles.pill, pressed && styles.pressed]}
      >
        <ProgressRing
          size={RING_SIZE}
          stroke={RING_STROKE}
          progress={summary.progress}
          color={closed ? tokens.color.semantic.success : accentPrimary}
          on={pageSurfaces(tokens).card}
        />
        <Text style={[styles.pillText, narrowed ? { color: accent } : null]}>
          {summary.total > 0
            ? `${summary.done}/${summary.total}`
            : summary.incomplete
              ? "–"
              : "0"}
        </Text>
      </Pressable>
      <WeekSheet
        ref={sheet}
        summary={summary}
        filter={filter}
        onFilter={onFilter}
      />
    </>
  );
}

/** The ring's lines, in a sheet sized to them. */
function WeekSheet({
  ref,
  summary,
  filter,
  onFilter,
}: {
  ref: RefObject<BottomSheetModal | null>;
  summary: ActivityWeekSummary;
  filter: ActivityAgendaFilter;
  onFilter: (filter: ActivityAgendaFilter) => void;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const insets = useSafeAreaInsets();
  const backgroundStyle = useSheetBackgroundStyle();
  const closeSheet = useSheetClose(ref);
  return (
    <BottomSheetModal
      ref={ref}
      stackBehavior={SHEET_STACK_BEHAVIOR}
      enableDynamicSizing
      backgroundStyle={backgroundStyle}
      handleComponent={SheetGrabber}
      backdropComponent={SheetScrim}
    >
      <SheetBackToClose onClose={closeSheet} />
      <BottomSheetView
        onAccessibilityEscape={closeSheet}
        style={[
          styles.sheetBody,
          { paddingBottom: insets.bottom + tokens.spacing.md },
        ]}
      >
        <SheetHeader title={summary.headline} />
        {summary.lines.length > 0 ? (
          <View>
            {summary.lines.map((line) => (
              <WeekLine
                key={line.id}
                line={line}
                selected={filter === line.id}
                onPress={() => {
                  onFilter(filter === line.id ? "all" : line.id);
                  closeSheet();
                }}
              />
            ))}
          </View>
        ) : summary.incomplete ? null : (
          <Text style={styles.quiet}>{ACTIVITY_WEEK_HINT}</Text>
        )}
        {summary.warning ? (
          <Text style={styles.warning}>
            {`${summary.warning} Pull down to try again.`}
          </Text>
        ) : null}
      </BottomSheetView>
    </BottomSheetModal>
  );
}

/** One line in the sheet: a kind, how far along it is, and its count. */
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

/** The ring before the first read, on the loaded pill's frame. */
export function WeekRingSkeleton() {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  return (
    <View style={styles.pill}>
      <SkeletonBlock width={RING_SIZE} height={RING_SIZE} radius={RING_SIZE} />
      <SkeletonBlock width={24} height={12} radius={4} />
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  const surfaces = pageSurfaces(tokens);
  const meter = meterStyles(tokens, surfaces.card);
  return StyleSheet.create({
    // The header round's fill, in a worded capsule, as Task board's.
    pill: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.xs,
      minHeight: 36,
      paddingHorizontal: tokens.spacing.sm,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: tokens.color.border.input,
      backgroundColor: surfaces.card,
    },
    pillText: {
      ...typeRole({
        ...tokens.typography.role.caption,
        weight: tokens.typography.weight.semibold,
      }),
      fontVariant: ["tabular-nums"],
      color: tokens.color.text.foreground,
    },
    pressed: { opacity: 0.7 },
    sheetBody: {
      paddingHorizontal: tokens.spacing.lg,
      gap: tokens.spacing.xs,
    },
    quiet: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    warning: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.warning,
    },
    line: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
      minHeight: tokens.touch.minimum,
    },
    // One column each, so every line's bar starts and ends on the same
    // edges whatever its label and count say.
    lineLabel: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
      flexGrow: 3,
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
  });
}
