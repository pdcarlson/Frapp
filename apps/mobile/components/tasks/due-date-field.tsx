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
import Svg, { Path } from "react-native-svg";
import { localIsoDate, parseBareDateLocalNoon } from "@repo/formatting";
import { TASK_NO_DUE_DATE_LABEL } from "@repo/validation";
import { SignetTokens } from "@repo/theme/signet";
import { typeRole, useFrappTheme } from "@/lib/theme";
import { useChapterBranding } from "@/lib/chapter-branding";
import { CalendarGlyph } from "@/components/tasks/task-glyphs";
import { formatDueFieldLabel } from "@/lib/tasks/create-task";

/**
 * The New task sheet's due date as the platform's own picker
 * (`spec/ui/design-system/components.md` § Time and date pickers, #3597): on
 * iOS the compact date picker sits in the field; elsewhere the field is a
 * button that opens the system dialog. Any day from today on, so a task can
 * be due weeks out, not only on a preset chip's day. `platform` is a prop so
 * a spec can draw either.
 *
 * A task's due can be taken off (#5761) where the host passes `onClear`: a
 * clear button beside the day, as `DueTimeField` takes a time off (Apple
 * Reminders' Date switch, Todoist's "No date"). With no day the field reads
 * "No due date", and a tap gives it one: today on iOS, where the picker then
 * sits in the field, or the system dialog elsewhere.
 */
export function DueDateField({
  value,
  today,
  disabled,
  onChange,
  label = "Due",
  format = formatDueFieldLabel,
  onClear,
  platform = Platform.OS,
}: {
  /** `YYYY-MM-DD`, device-local, or `null` for no due date (#5761). */
  value: string | null;
  /** `YYYY-MM-DD`, device-local: the earliest day it offers. */
  today: string;
  disabled: boolean;
  onChange: (next: string) => void;
  /**
   * What a screen reader says before the day: "Due" on a task, "Day" on a
   * minutes' Coming up row (#4412).
   */
  label?: string;
  /**
   * How the day reads where the field draws it (Android, and every screen
   * reader): "Fri, Aug 21" on a task; written out on the minutes' editor,
   * as the minutes read (#4412).
   */
  format?: (isoDate: string) => string;
  /** Takes the day off (#5761); absent, the field always holds a day. */
  onClear?: () => void;
  platform?: string;
}) {
  const { tokens } = useFrappTheme();
  const brand = useChapterBranding();
  const styles = createStyles(tokens);
  const muted = tokens.color.text.mutedForeground;
  const date =
    (value ? parseBareDateLocalNoon(value) : null) ??
    parseBareDateLocalNoon(today) ??
    new Date();
  const minimumDate = parseBareDateLocalNoon(today) ?? undefined;
  const shown = value ? format(value) : TASK_NO_DUE_DATE_LABEL;
  const pick = (picked: Date | undefined) => {
    if (picked) onChange(localIsoDate(picked));
  };
  const openAndroid = () => {
    Keyboard.dismiss();
    DateTimePickerAndroid.open({
      value: date,
      mode: "date",
      minimumDate,
      onValueChange: (_event, picked) => pick(picked),
    });
  };

  if (value === null) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label} ${shown}`}
        accessibilityHint="Gives it a due date."
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={() => {
          // iOS shows the picker in the field once there is a day; Android
          // asks first, so a dismissed dialog adds nothing.
          if (platform === "ios") onChange(today);
          else openAndroid();
        }}
        style={styles.row}
      >
        <CalendarGlyph color={muted} />
        <Text style={styles.placeholder} numberOfLines={1}>
          {shown}
        </Text>
      </Pressable>
    );
  }

  const clear = onClear ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={TASK_NO_DUE_DATE_LABEL}
      accessibilityHint="Takes the due date off."
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={10}
      onPress={onClear}
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
  ) : null;

  if (platform === "ios") {
    return (
      <View style={styles.row}>
        <CalendarGlyph color={muted} />
        <View style={styles.grow}>
          <DateTimePicker
            value={date}
            mode="date"
            display="compact"
            themeVariant="dark"
            accentColor={brand.accent}
            minimumDate={minimumDate}
            disabled={disabled}
            accessibilityLabel={`${label} ${shown}`}
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
        accessibilityLabel={`${label} ${shown}`}
        accessibilityHint="Opens the date picker."
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={openAndroid}
        style={[styles.row, styles.grow]}
      >
        <CalendarGlyph color={muted} />
        <Text style={styles.value}>{shown}</Text>
      </Pressable>
      {clear}
    </View>
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
    value: {
      flex: 1,
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    placeholder: {
      flex: 1,
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.muted,
    },
    clear: {
      padding: tokens.spacing.xs,
    },
  });
}
