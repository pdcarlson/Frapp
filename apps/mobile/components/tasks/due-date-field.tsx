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
import { localIsoDate, parseBareDateLocalNoon } from "@repo/formatting";
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
 */
export function DueDateField({
  value,
  today,
  disabled,
  onChange,
  platform = Platform.OS,
}: {
  /** `YYYY-MM-DD`, device-local. */
  value: string;
  /** `YYYY-MM-DD`, device-local: the earliest day it offers. */
  today: string;
  disabled: boolean;
  onChange: (next: string) => void;
  platform?: string;
}) {
  const { tokens } = useFrappTheme();
  const brand = useChapterBranding();
  const styles = createStyles(tokens);
  const date = parseBareDateLocalNoon(value) ?? new Date();
  const minimumDate = parseBareDateLocalNoon(today) ?? undefined;
  const label = formatDueFieldLabel(value);
  const pick = (picked: Date | undefined) => {
    if (picked) onChange(localIsoDate(picked));
  };

  if (platform === "ios") {
    return (
      <View style={styles.row}>
        <CalendarGlyph color={tokens.color.text.mutedForeground} />
        <DateTimePicker
          value={date}
          mode="date"
          display="compact"
          themeVariant="dark"
          accentColor={brand.accent}
          minimumDate={minimumDate}
          disabled={disabled}
          accessibilityLabel={`Due ${label}`}
          onValueChange={(_event, picked) => pick(picked)}
        />
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Due ${label}`}
      accessibilityHint="Opens the date picker."
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => {
        Keyboard.dismiss();
        DateTimePickerAndroid.open({
          value: date,
          mode: "date",
          minimumDate,
          onValueChange: (_event, picked) => pick(picked),
        });
      }}
      style={styles.row}
    >
      <CalendarGlyph color={tokens.color.text.mutedForeground} />
      <Text style={styles.value}>{label}</Text>
    </Pressable>
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
    value: {
      flex: 1,
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
  });
}
