import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { localIsoDate } from "@repo/formatting";
import { SignetTokens } from "@repo/theme/signet";
import { Chip } from "@/components/filter-chips";
import { useChapterBranding } from "@/lib/chapter-branding";
import {
  joinClock,
  MINUTE_STEPS,
  monthGrid,
  splitClock,
  type ClockMinutes,
} from "@/lib/events/create-event";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * The New event sheet's day and time pickers, drawn in JS because the app
 * carries no native picker (`lib/events/create-event.ts` says why). Each opens
 * inline under the field it sets, one at a time, and is fixed taps rather than
 * a wheel, so nothing scrolls inside the sheet's own drag.
 */

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"] as const;
const HOURS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

/** A day cell, and the selected day's filled circle inside it. */
const DAY_CELL = 40;
const DAY_DOT = 36;

/**
 * A month of days, Sunday first. Days before today are drawn muted and can't
 * be picked: an event is not created into the past from the phone. The
 * selected day is the chapter accent's filled circle, the way a chip that is
 * on is painted (components.md §3); today is the foreground in bold.
 */
export function DayCalendar({
  value,
  now,
  onChange,
}: {
  /** `YYYY-MM-DD`. */
  value: string;
  now: Date;
  onChange: (date: string) => void;
}) {
  const { tokens } = useFrappTheme();
  const { accentPrimary, accentOnPrimary } = useChapterBranding();
  const styles = createStyles(tokens);
  const today = localIsoDate(now);

  // The month on screen starts at the picked day's, and pages from there.
  const [shown, setShown] = useState(() => {
    const [year, month] = value.split("-").map(Number) as [number, number];
    return { year, month: month - 1 };
  });
  const weeks = useMemo(
    () => monthGrid(shown.year, shown.month),
    [shown.year, shown.month],
  );
  const title = new Date(shown.year, shown.month, 1).toLocaleDateString(
    undefined,
    { month: "long", year: "numeric" },
  );
  const atThisMonth =
    shown.year === now.getFullYear() && shown.month === now.getMonth();

  function page(delta: number) {
    setShown(({ year, month }) => {
      const next = new Date(year, month + delta, 1);
      return { year: next.getFullYear(), month: next.getMonth() };
    });
  }

  return (
    <View style={styles.calendar} accessibilityLabel="Event day">
      <View style={styles.monthRow}>
        <Text style={styles.monthTitle} accessibilityRole="header">
          {title}
        </Text>
        <View style={styles.monthNav}>
          <MonthArrow
            label="Previous month"
            glyph="‹"
            disabled={atThisMonth}
            onPress={() => page(-1)}
          />
          <MonthArrow label="Next month" glyph="›" onPress={() => page(1)} />
        </View>
      </View>

      <View style={styles.week}>
        {WEEKDAYS.map((letter, index) => (
          <Text
            key={index}
            style={styles.weekday}
            importantForAccessibility="no"
          >
            {letter}
          </Text>
        ))}
      </View>

      {weeks.map((week, index) => (
        <View key={index} style={styles.week}>
          {week.map((date, column) => {
            if (!date) return <View key={column} style={styles.dayCell} />;
            const selected = date === value;
            // `YYYY-MM-DD` orders as a string.
            const past = date < today;
            const isToday = date === today;
            return (
              <Pressable
                key={date}
                accessibilityRole="button"
                accessibilityLabel={spokenDay(date)}
                accessibilityState={{ selected, disabled: past }}
                disabled={past}
                onPress={() => onChange(date)}
                style={styles.dayCell}
              >
                <View
                  style={[
                    styles.dayDot,
                    selected ? { backgroundColor: accentPrimary } : null,
                  ]}
                >
                  <Text
                    style={[
                      styles.dayText,
                      past ? styles.dayPast : null,
                      isToday ? styles.dayToday : null,
                      selected ? { color: accentOnPrimary } : null,
                    ]}
                  >
                    {Number(date.slice(8))}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

function MonthArrow({
  label,
  glyph,
  disabled = false,
  onPress,
}: {
  label: string;
  glyph: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={8}
      style={styles.arrow}
    >
      <Text style={[styles.arrowGlyph, disabled ? styles.dayPast : null]}>
        {glyph}
      </Text>
    </Pressable>
  );
}

function spokenDay(date: string): string {
  const [year, month, day] = date.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

/**
 * A time as three picks: the hour, the quarter hour, and AM or PM. Chips, as
 * the sheet's other choices are, so a picked value reads the same here as a
 * due chip does on New task.
 */
export function TimeGrid({
  label,
  value,
  onChange,
}: {
  /** "Start time" or "End time", for a screen reader. */
  label: string;
  value: ClockMinutes;
  onChange: (minutes: ClockMinutes) => void;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const { hour12, minute, pm } = splitClock(value);

  return (
    <View style={styles.timeGrid} accessibilityLabel={label}>
      <View style={styles.chipRow} accessibilityRole="radiogroup">
        {HOURS.map((hour) => (
          <Chip
            key={hour}
            label={String(hour)}
            on={hour === hour12}
            accessibilityRole="radio"
            accessibilityState={{ checked: hour === hour12 }}
            accessibilityLabel={`${hour} o'clock`}
            onPress={() => onChange(joinClock(hour, minute, pm))}
          />
        ))}
      </View>
      <View style={styles.splitChips}>
        <View style={styles.chipRow} accessibilityRole="radiogroup">
          {MINUTE_STEPS.map((step) => (
            <Chip
              key={step}
              label={`:${String(step).padStart(2, "0")}`}
              on={step === minute}
              accessibilityRole="radio"
              accessibilityState={{ checked: step === minute }}
              accessibilityLabel={`${step} minutes past`}
              onPress={() => onChange(joinClock(hour12, step, pm))}
            />
          ))}
        </View>
        <View style={styles.chipRow} accessibilityRole="radiogroup">
          {(["AM", "PM"] as const).map((half) => {
            const on = (half === "PM") === pm;
            return (
              <Chip
                key={half}
                label={half}
                accessibilityLabel={half}
                on={on}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                onPress={() =>
                  onChange(joinClock(hour12, minute, half === "PM"))
                }
              />
            );
          })}
        </View>
      </View>
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  const caption = typeRole(tokens.typography.role.caption);
  return StyleSheet.create({
    calendar: {
      paddingVertical: tokens.spacing.xs,
    },
    monthRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingBottom: tokens.spacing.xs,
    },
    monthTitle: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    monthNav: {
      flexDirection: "row",
      gap: tokens.spacing.md,
    },
    arrow: {
      minWidth: 32,
      minHeight: 32,
      alignItems: "center",
      justifyContent: "center",
    },
    arrowGlyph: {
      ...typeRole(tokens.typography.role.title),
      color: tokens.color.text.foreground,
    },
    week: {
      flexDirection: "row",
    },
    weekday: {
      ...caption,
      flex: 1,
      textAlign: "center",
      color: tokens.color.text.muted,
      paddingVertical: tokens.spacing.xs,
    },
    dayCell: {
      flex: 1,
      height: DAY_CELL,
      alignItems: "center",
      justifyContent: "center",
    },
    dayDot: {
      width: DAY_DOT,
      height: DAY_DOT,
      borderRadius: DAY_DOT / 2,
      alignItems: "center",
      justifyContent: "center",
    },
    dayText: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    dayToday: {
      fontWeight: "700",
    },
    dayPast: {
      color: tokens.color.text.muted,
    },
    timeGrid: {
      gap: tokens.spacing.md,
      paddingVertical: tokens.spacing.xs,
    },
    chipRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      columnGap: tokens.spacing.sm,
      rowGap: tokens.spacing.md,
    },
    splitChips: {
      flexDirection: "row",
      flexWrap: "wrap",
      justifyContent: "space-between",
      rowGap: tokens.spacing.md,
    },
  });
}
