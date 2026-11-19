import { useState } from "react";
import {
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import DateTimePicker, {
  DateTimePickerAndroid,
} from "@react-native-community/datetimepicker";
import { formatWeekdayDay } from "@repo/formatting";
import type { SignetTokens } from "@repo/theme/signet";
import {
  EVENT_LENGTH_CHOICES,
  eventLengthLabel,
} from "@repo/validation";
import { TextAction } from "@/components/events/event-excuses";
import { formatEventClock } from "@/lib/events/format";
import { MINUTE_INTERVAL, withDay } from "@/lib/events/create-event";
import { useChapterBranding } from "@/lib/chapter-branding";
import { typeRole, useFrappTheme } from "@/lib/theme";

const DAY_MS = 24 * 60 * 60_000;

/** Minutes past midnight, on the device's clock. */
function minuteOfDay(at: Date): number {
  return at.getHours() * 60 + at.getMinutes();
}

function sameDay(a: Date, b: Date): boolean {
  return a.toDateString() === b.toDateString();
}

/**
 * Whether an event's end needs a day of its own: it ends on another day
 * than it starts, other than just past midnight (a 10 PM to 1 AM social).
 */
export function endsAnotherDay(start: Date, end: Date): boolean {
  if (sameDay(start, end)) return false;
  const overnight =
    end.getTime() - start.getTime() < DAY_MS &&
    sameDay(new Date(start.getTime() + DAY_MS), end) &&
    minuteOfDay(end) <= minuteOfDay(start);
  return !overnight;
}

/**
 * An end time picked against the start: on the start's day, or the next one
 * when it is at or before the start, so it runs past midnight.
 */
export function endAtTime(start: Date, time: Date): Date {
  const end = withDay(time, start);
  return end <= start ? new Date(end.getTime() + DAY_MS) : end;
}

/**
 * The New event sheet's When, opened (Paul 2026-11-19: "typing the exact same
 * thing in the second row and just adding an hour is really tedious"): the
 * day once, then the start and end as times, the way Google Calendar and web's
 * form set them out (`WhenFields` in `apps/web/components/events/
 * event-editor-dialog.tsx`). Under them, how long it runs as one tap each,
 * the lengths web's end list labels its times with. Moving the day or the
 * start carries the end along (the sheet's `setStart`); an end before the
 * start runs past midnight. A meeting that spans days gets its end's own day
 * from "Ends another day". Each picker is the platform's own (owner,
 * 2026-11-06).
 */
export function WhenTimes({
  start,
  end,
  now,
  minimumDate,
  disabled,
  onStart,
  onEnd,
  platform = Platform.OS,
}: {
  start: Date;
  end: Date;
  now: Date;
  minimumDate: Date;
  disabled: boolean;
  onStart: (next: Date) => void;
  onEnd: (next: Date) => void;
  platform?: string;
}) {
  const { tokens } = useFrappTheme();
  const brand = useChapterBranding();
  const styles = createStyles(tokens);
  const [askedForEndDay, setAskedForEndDay] = useState(false);
  const spans = askedForEndDay || endsAnotherDay(start, end);
  const floor = start < minimumDate ? start : minimumDate;
  const minimumDay = new Date(
    floor.getFullYear(),
    floor.getMonth(),
    floor.getDate(),
  );
  const startDay = new Date(
    start.getFullYear(),
    start.getMonth(),
    start.getDate(),
  );
  const lengthMinutes = Math.round((end.getTime() - start.getTime()) / 60_000);

  const day = (value: Date) => formatWeekdayDay(value.toISOString(), now) ?? "";
  const pickEndTime = (picked: Date) =>
    onEnd(spans ? withDay(picked, end) : endAtTime(start, picked));

  return (
    <View style={styles.stack}>
      <Line label="Day">
        <Picker
          mode="date"
          value={start}
          text={day(start)}
          label={`Starts day, ${day(start)}`}
          minimumDate={minimumDay}
          disabled={disabled}
          platform={platform}
          accent={brand.accent}
          onPick={(picked) => onStart(withDay(start, picked))}
        />
      </Line>
      <Line label="Time">
        <Picker
          mode="time"
          value={start}
          text={formatEventClock(start)}
          label={`Starts time, ${formatEventClock(start)}`}
          disabled={disabled}
          platform={platform}
          accent={brand.accent}
          onPick={(picked) => onStart(withDay(picked, start))}
        />
        <Text style={styles.dash}>–</Text>
        <Picker
          mode="time"
          value={end}
          text={formatEventClock(end)}
          label={`Ends time, ${formatEventClock(end)}`}
          disabled={disabled}
          platform={platform}
          accent={brand.accent}
          onPick={pickEndTime}
        />
      </Line>
      {spans ? (
        <Line label="Ends">
          <Picker
            mode="date"
            value={end}
            text={day(end)}
            label={`Ends day, ${day(end)}`}
            minimumDate={startDay}
            disabled={disabled}
            platform={platform}
            accent={brand.accent}
            onPick={(picked) => onEnd(withDay(end, picked))}
          />
        </Line>
      ) : null}
      {/* How long, one tap each: the end moves, the start stays. */}
      <View style={styles.chips} accessibilityRole="radiogroup">
        {EVENT_LENGTH_CHOICES.map((minutes) => {
          const held = minutes === lengthMinutes;
          const label = eventLengthLabel(minutes);
          return (
            <Pressable
              key={minutes}
              accessibilityRole="radio"
              accessibilityLabel={`Lasts ${label}`}
              accessibilityState={{ checked: held, disabled }}
              disabled={disabled}
              hitSlop={tokens.spacing.xs}
              onPress={() =>
                onEnd(new Date(start.getTime() + minutes * 60_000))
              }
              style={({ pressed }) => [
                styles.chip,
                held
                  ? { backgroundColor: brand.accentSubtle, borderColor: brand.accentBorder }
                  : null,
                pressed ? styles.pressed : null,
              ]}
            >
              <Text
                style={[styles.chipText, held ? { color: brand.accent } : null]}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {!spans ? (
        <View style={styles.endDay}>
          <TextAction
            label="Ends another day"
            compact
            disabled={disabled}
            onPress={() => setAskedForEndDay(true)}
          />
        </View>
      ) : null}
    </View>
  );
}

function Line({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  return (
    <View style={styles.line}>
      <Text style={styles.lineLabel}>{label}</Text>
      <View style={styles.pickers}>{children}</View>
    </View>
  );
}

/**
 * One picker: the native compact pill on iOS, whose popover is the calendar
 * or the time wheel; on Android a quiet chip that opens the system dialog.
 */
function Picker({
  mode,
  value,
  text,
  label,
  minimumDate,
  disabled,
  platform,
  accent,
  onPick,
}: {
  mode: "date" | "time";
  value: Date;
  text: string;
  label: string;
  minimumDate?: Date;
  disabled: boolean;
  platform: string;
  accent: string;
  onPick: (picked: Date) => void;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  if (platform === "ios") {
    return (
      <DateTimePicker
        value={value}
        mode={mode}
        display="compact"
        themeVariant="dark"
        accentColor={accent}
        disabled={disabled}
        {...(mode === "date" && minimumDate ? { minimumDate } : {})}
        {...(mode === "time" ? { minuteInterval: MINUTE_INTERVAL } : {})}
        accessibilityLabel={label}
        onValueChange={(_event, picked) => onPick(picked)}
      />
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={
        mode === "date" ? "Opens the date picker." : "Opens the time picker."
      }
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => {
        Keyboard.dismiss();
        DateTimePickerAndroid.open({
          value,
          mode,
          ...(mode === "date" && minimumDate ? { minimumDate } : {}),
          onValueChange: (_event, picked) => onPick(picked),
        });
      }}
      style={styles.pill}
    >
      <Text style={styles.pillText}>{text}</Text>
    </Pressable>
  );
}

function createStyles(tokens: SignetTokens) {
  const rowText = {
    ...typeRole(tokens.typography.role.body),
    color: tokens.color.text.foreground,
  };
  return StyleSheet.create({
    stack: {
      gap: tokens.spacing.xs,
    },
    line: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      minHeight: tokens.touch.minimum + tokens.spacing.xs,
      gap: tokens.spacing.sm,
    },
    lineLabel: rowText,
    pickers: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.xs,
    },
    dash: {
      ...rowText,
      color: tokens.color.text.mutedForeground,
    },
    pill: {
      minHeight: 34,
      justifyContent: "center",
      paddingHorizontal: tokens.spacing.md,
      borderRadius: tokens.radius.chip,
      backgroundColor: tokens.color.surface.popover,
    },
    pillText: rowText,
    chips: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: tokens.spacing.xs,
      paddingVertical: tokens.spacing.xs,
    },
    chip: {
      minHeight: 32,
      justifyContent: "center",
      paddingHorizontal: tokens.spacing.md,
      borderRadius: tokens.radius.chip,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
    },
    chipText: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    pressed: {
      opacity: 0.7,
    },
    endDay: {
      alignItems: "flex-start",
    },
  });
}
