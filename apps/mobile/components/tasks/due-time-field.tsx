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
import Svg, { Circle, Path } from "react-native-svg";
import { SignetTokens } from "@repo/theme/signet";
import { typeRole, useFrappTheme } from "@/lib/theme";
import { useChapterBranding } from "@/lib/chapter-branding";
import { formatDueTimeLabel } from "@repo/formatting";

/**
 * The New task sheet's optional time of day (#4003). Most tasks are due by a
 * day, so the field starts as a quiet "Add a time" line rather than a picker
 * every task has to answer. Tapping it gives the task a time; once it has
 * one, the platform's time picker sits in the field (iOS) or opens from it
 * (elsewhere), and a clear button takes the time off again, the way Apple
 * Reminders' Time switch and Todoist's time chip work.
 *
 * `value` is `HH:MM` on the 24-hour clock, device-local, or `null` for none.
 * `platform` is a prop so a spec can draw either.
 */
export function DueTimeField({
  value,
  suggested,
  disabled,
  onChange,
  platform = Platform.OS,
}: {
  value: string | null;
  /** The time "Add a time" starts from, `HH:MM`. */
  suggested: string;
  disabled: boolean;
  onChange: (next: string | null) => void;
  platform?: string;
}) {
  const { tokens } = useFrappTheme();
  const brand = useChapterBranding();
  const styles = createStyles(tokens);
  const muted = tokens.color.text.mutedForeground;
  const pick = (picked: Date | undefined) => {
    if (picked) onChange(clockOf(picked));
  };

  const openAndroid = (from: string) => {
    Keyboard.dismiss();
    DateTimePickerAndroid.open({
      value: dateAt(from),
      mode: "time",
      onValueChange: (_event, picked) => pick(picked),
    });
  };

  if (value === null) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add a time"
        accessibilityHint="Sets a time of day the task is due."
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={() => {
          // iOS shows the picker in the field once there is a time; Android
          // asks first, so a dismissed dialog adds nothing.
          if (platform === "ios") onChange(suggested);
          else openAndroid(suggested);
        }}
        style={styles.row}
      >
        <ClockGlyph color={muted} />
        <Text style={styles.placeholder}>Add a time</Text>
      </Pressable>
    );
  }

  const label = formatDueTimeLabel(value);
  const clear = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Remove the time"
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={10}
      onPress={() => onChange(null)}
      style={styles.clear}
    >
      <Svg width={14} height={14} viewBox="0 0 24 24">
        <Path
          d="M6 6l12 12M18 6L6 18"
          stroke={muted}
          strokeWidth={2}
          strokeLinecap="round"
        />
      </Svg>
    </Pressable>
  );

  if (platform === "ios") {
    return (
      <View style={styles.row}>
        <ClockGlyph color={muted} />
        <View style={styles.grow}>
          <DateTimePicker
            value={dateAt(value)}
            mode="time"
            display="compact"
            themeVariant="dark"
            accentColor={brand.accent}
            disabled={disabled}
            accessibilityLabel={`Due at ${label}`}
            onValueChange={(_event, picked) => pick(picked)}
          />
        </View>
        {clear}
      </View>
    );
  }

  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Due at ${label}`}
        accessibilityHint="Opens the time picker."
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={() => openAndroid(value)}
        style={[styles.row, styles.grow]}
      >
        <ClockGlyph color={muted} />
        <Text style={styles.value}>{label}</Text>
      </Pressable>
      {clear}
    </View>
  );
}

/** Today at `HH:MM`: the picker only reads the clock off it. */
function dateAt(time: string): Date {
  const [hours = 17, minutes = 0] = time.split(":").map(Number);
  const at = new Date();
  at.setHours(hours, minutes, 0, 0);
  return at;
}

function clockOf(at: Date): string {
  return `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
}

/** A clock face, stroked like the field's `CalendarGlyph`. */
function ClockGlyph({ color, size = 17 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle
        cx={12}
        cy={12}
        r={8.5}
        stroke={color}
        strokeWidth={1.7}
        fill="none"
      />
      <Path
        d="M12 7.5V12l3 2"
        stroke={color}
        strokeWidth={1.7}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    row: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
    },
    grow: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
    },
    placeholder: {
      flex: 1,
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.muted,
    },
    value: {
      flex: 1,
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    clear: {
      padding: tokens.spacing.xs,
    },
  });
}
