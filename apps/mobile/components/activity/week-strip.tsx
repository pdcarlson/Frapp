import { Pressable, StyleSheet, Text, View } from "react-native";
import { ACTIVITY_STRIP_HUE, type ActivityStripDay } from "@repo/hooks";
import type { SignetTokens } from "@repo/theme/signet";
import { SkeletonBlock } from "@/components/state-block";
import { useChapterBranding } from "@/lib/chapter-branding";
import { typeRole, useFrappTheme } from "@/lib/theme";

/** Sunday first, as the month grid heads its columns. */
const WEEKDAY_INITIALS = ["S", "M", "T", "W", "T", "F", "S"] as const;

/** A dot's diameter: the month mock's, legible at a glance and no louder. */
const DOT_SIZE = 6;

/**
 * The week strip over Activity's week card (#5310, Paul's direction B):
 * today and the six days after it, each a column with its weekday, its date
 * and a coloured dot per kind due that day (events sky, tasks green, polls
 * and sign-ups violet). The dots say how the week is shaped before a word is
 * read, as Fantastical's DayTicker and Things' Upcoming strip do.
 *
 * Pressing a day with something on it jumps To do to that day; a day with
 * nothing has nowhere to go and is drawn but not pressable. The picked day
 * wears the accent's quiet fill and border, as the month grid's selected
 * day does, so the dots keep their hues; until a day is picked, today is.
 */
export function WeekStrip({
  days,
  selectedId,
  onSelect,
}: {
  days: ActivityStripDay[];
  /** The day last jumped to, or `null` for today. */
  selectedId: string | null;
  onSelect: (day: ActivityStripDay) => void;
}) {
  const { tokens } = useFrappTheme();
  const { accent, accentSubtle, accentBorder } = useChapterBranding();
  const styles = createStyles(tokens);
  const picked = selectedId ?? days[0]?.id ?? null;
  return (
    <View style={styles.strip} testID="activity-week-strip">
      {days.map((day, index) => {
        const selected = day.id === picked;
        const isToday = index === 0;
        const empty = day.kinds.length === 0;
        return (
          <Pressable
            key={day.id}
            accessibilityRole="button"
            accessibilityLabel={day.spokenLabel}
            accessibilityState={{ selected, disabled: empty }}
            accessibilityHint={empty ? undefined : "Jumps To do to this day."}
            disabled={empty}
            onPress={() => onSelect(day)}
            testID={`activity-strip-${day.id}`}
            style={({ pressed }) => [
              styles.day,
              selected
                ? { backgroundColor: accentSubtle, borderColor: accentBorder }
                : null,
              pressed ? styles.pressed : null,
            ]}
          >
            <Text
              style={[
                styles.weekday,
                selected || isToday ? { color: accent } : null,
              ]}
            >
              {WEEKDAY_INITIALS[day.date.getDay()]}
            </Text>
            <Text
              style={[
                styles.date,
                selected || isToday ? { color: accent } : null,
              ]}
            >
              {day.date.getDate()}
            </Text>
            <View style={styles.dots}>
              {day.kinds.map((kind) => (
                <View
                  key={kind}
                  testID={`activity-strip-dot-${day.id}-${kind}`}
                  style={[
                    styles.dot,
                    { backgroundColor: ACTIVITY_STRIP_HUE[kind] },
                  ]}
                />
              ))}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

/** The strip before the first read: seven columns on the loaded frame. */
export function WeekStripSkeleton() {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  return (
    <View style={styles.strip}>
      {Array.from({ length: 7 }, (_, index) => (
        <View key={index} style={styles.day}>
          <SkeletonBlock width={10} height={10} />
          <SkeletonBlock width={18} height={16} />
        </View>
      ))}
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    strip: {
      flexDirection: "row",
      gap: tokens.spacing.xs,
    },
    // Seven equal columns at the touch floor's height, so a thumb lands on
    // a day across a 375pt phone.
    day: {
      flex: 1,
      minHeight: tokens.touch.minimum + tokens.spacing.md,
      alignItems: "center",
      justifyContent: "center",
      gap: 2,
      paddingVertical: tokens.spacing.xs,
      borderRadius: tokens.radius.card,
      borderWidth: 1,
      borderColor: "transparent",
    },
    pressed: { opacity: 0.7 },
    weekday: {
      ...typeRole({
        ...tokens.typography.role.caption,
        weight: tokens.typography.weight.semibold,
      }),
      color: tokens.color.text.mutedForeground,
    },
    date: {
      ...typeRole({
        ...tokens.typography.role.label,
        weight: tokens.typography.weight.bold,
      }),
      fontVariant: ["tabular-nums"],
      color: tokens.color.text.foreground,
    },
    // Held at a dot's height when empty, so every column lines up.
    dots: {
      flexDirection: "row",
      gap: 3,
      height: DOT_SIZE,
    },
    dot: {
      width: DOT_SIZE,
      height: DOT_SIZE,
      borderRadius: DOT_SIZE / 2,
    },
  });
}
