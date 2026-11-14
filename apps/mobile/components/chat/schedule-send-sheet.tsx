import { forwardRef, useCallback, useRef, useState } from "react";
import {
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { BottomSheetModal, BottomSheetView } from "@gorhom/bottom-sheet";
import DateTimePicker, {
  DateTimePickerAndroid,
} from "@react-native-community/datetimepicker";
import {
  formatScheduleTime,
  SCHEDULE_MAX_DAYS,
  schedulePresets,
  scheduleTimeProblem,
} from "@repo/hooks";
import { errorCopy } from "@repo/hooks/error-copy";
import { SignetTokens } from "@repo/theme/signet";
import { typeRole, useFrappTheme } from "@/lib/theme";
import {
  type ChapterBranding,
  useChapterBranding,
} from "@/lib/chapter-branding";
import { withDay } from "@/lib/chat/schedule-send";
import {
  SheetBackToClose,
  SheetGrabber,
  SheetHeader,
  SheetPrimaryButton,
  SheetScrim,
  SHEET_STACK_BEHAVIOR,
  useSheetBackgroundStyle,
  useSheetClose,
} from "@/components/sheet-scaffold";

/**
 * Schedule message (#4956), opened by a long press on Send, as Slack's phone
 * app opens it: the presets (tomorrow and Monday at 9) and a custom date and
 * time, all on the member's own clock (`scheduled-message-times` in
 * `@repo/hooks`, web's own rules). The draft it will post heads the sheet, so
 * the member sees what they are scheduling.
 *
 * What can't be scheduled (a photo or a reply staged, a question for Frapp,
 * offline) still opens the sheet, with the reason and the rows greyed, the way
 * the + sheet says what can't work this second: a long press that did
 * nothing would read as a missed press.
 *
 * `onSchedule` resolves once the message is scheduled, and the sheet closes;
 * a rejection keeps it open with the reason under the rows.
 */
export interface ScheduleSendSheetProps {
  /** The draft, as it will post. */
  preview: string;
  /** Why it can't be scheduled now, or `null`. */
  refusal: string | null;
  onSchedule: (at: Date) => Promise<void>;
}

export const ScheduleSendSheet = forwardRef<
  BottomSheetModal,
  ScheduleSendSheetProps
>(function ScheduleSendSheet({ preview, refusal, onSchedule }, ref) {
  const { tokens } = useFrappTheme();
  const brand = useChapterBranding();
  const styles = createStyles(tokens);
  const backgroundStyle = useSheetBackgroundStyle();
  const closeSheet = useSheetClose(ref);
  const [now, setNow] = useState(() => new Date());
  const presets = schedulePresets(now);
  const [custom, setCustom] = useState<Date | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A second tap inside one render would schedule it twice.
  const inFlight = useRef(false);

  const schedule = useCallback(
    (at: Date) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setBusy(true);
      setError(null);
      onSchedule(at)
        .then(() => closeSheet())
        .catch((cause: unknown) => setError(errorCopy(cause)))
        .finally(() => {
          inFlight.current = false;
          setBusy(false);
        });
    },
    [closeSheet, onSchedule],
  );

  // Each visit starts fresh: the presets read the clock as it opens.
  const reset = () => {
    setNow(new Date());
    setCustom(null);
    setError(null);
  };

  const blocked = refusal !== null || busy;
  const problem = custom ? scheduleTimeProblem(custom, new Date()) : null;

  return (
    <BottomSheetModal
      ref={ref}
      stackBehavior={SHEET_STACK_BEHAVIOR}
      enableDynamicSizing
      backgroundStyle={backgroundStyle}
      handleComponent={SheetGrabber}
      backdropComponent={SheetScrim}
      onDismiss={reset}
    >
      <SheetBackToClose onClose={closeSheet} />
      <BottomSheetView onAccessibilityEscape={closeSheet} style={styles.body}>
        <SheetHeader title="Schedule message" />
        {preview ? (
          <Text style={styles.preview} numberOfLines={2}>
            {preview}
          </Text>
        ) : null}
        {refusal ? (
          <Text accessibilityLiveRegion="polite" style={styles.reason}>
            {refusal}
          </Text>
        ) : null}
        {presets.map((preset) => (
          <Pressable
            key={preset.key}
            accessibilityRole="button"
            accessibilityState={blocked ? { disabled: true } : undefined}
            disabled={blocked}
            onPress={() => schedule(preset.at)}
            style={({ pressed }) => [
              styles.row,
              blocked ? styles.rowDisabled : null,
              pressed ? styles.rowPressed : null,
            ]}
          >
            <Text style={styles.rowLabel}>{preset.label}</Text>
          </Pressable>
        ))}
        <Pressable
          accessibilityRole="button"
          accessibilityState={
            blocked ? { disabled: true } : { expanded: custom !== null }
          }
          disabled={blocked}
          onPress={() => setCustom((open) => (open ? null : presets[0].at))}
          style={({ pressed }) => [
            styles.row,
            blocked ? styles.rowDisabled : null,
            pressed ? styles.rowPressed : null,
          ]}
        >
          <Text style={styles.rowLabel}>Custom time</Text>
        </Pressable>
        {custom ? (
          <View style={styles.custom}>
            <ScheduleWhenField
              value={custom}
              onChange={setCustom}
              disabled={blocked}
              brand={brand}
            />
            {problem ? (
              <Text accessibilityLiveRegion="polite" style={styles.reason}>
                {problem}
              </Text>
            ) : null}
            <SheetPrimaryButton
              label="Schedule"
              onPress={() => schedule(custom)}
              disabled={blocked || problem !== null}
              busy={busy}
              accent={brand.accent}
              onAccent={tokens.color.gold.onHouse}
              accessibilityHint={problem ?? refusal ?? undefined}
            />
          </View>
        ) : null}
        {error ? (
          <Text accessibilityLiveRegion="polite" style={styles.reason}>
            {error}
          </Text>
        ) : null}
        <Text style={styles.footnote}>
          It posts as you at that time, on your clock.
        </Text>
      </BottomSheetView>
    </BottomSheetModal>
  );
});

/**
 * A scheduled message's day and time: the platform's compact pickers side by
 * side on iOS, and two pills that open the system dialogs elsewhere, as New
 * event's When row draws them. The day stops at today and at the API's 120
 * days; a time already past today is caught by `scheduleTimeProblem`, since a
 * minimum time would also stop a later day's early hours.
 *
 * `platform` is a prop so a spec can draw either.
 */
export function ScheduleWhenField({
  value,
  onChange,
  disabled,
  brand,
  platform = Platform.OS,
}: {
  value: Date;
  onChange: (next: Date) => void;
  disabled: boolean;
  brand: Pick<ChapterBranding, "accent">;
  platform?: string;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const today = new Date();
  const minimumDate = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  const maximumDate = new Date(minimumDate);
  maximumDate.setDate(maximumDate.getDate() + SCHEDULE_MAX_DAYS);
  const day = new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(value);
  const time = formatScheduleTime(value);

  if (platform === "ios") {
    const shared = {
      value,
      display: "compact" as const,
      themeVariant: "dark" as const,
      accentColor: brand.accent,
      disabled,
    };
    return (
      <View style={styles.whenRow}>
        <DateTimePicker
          {...shared}
          mode="date"
          minimumDate={minimumDate}
          maximumDate={maximumDate}
          accessibilityLabel={`Day, ${day}`}
          onValueChange={(_event, picked) => onChange(withDay(picked, value))}
        />
        <DateTimePicker
          {...shared}
          mode="time"
          accessibilityLabel={`Time, ${time}`}
          onValueChange={(_event, picked) => onChange(withDay(value, picked))}
        />
      </View>
    );
  }

  function open(mode: "date" | "time") {
    Keyboard.dismiss();
    DateTimePickerAndroid.open({
      value,
      mode,
      ...(mode === "date" ? { minimumDate, maximumDate } : {}),
      onValueChange: (_event, picked) =>
        onChange(
          mode === "date" ? withDay(picked, value) : withDay(value, picked),
        ),
    });
  }

  return (
    <View style={styles.whenRow}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Day, ${day}`}
        accessibilityHint="Opens the date picker."
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={() => open("date")}
        style={styles.pill}
      >
        <Text style={styles.pillText}>{day}</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Time, ${time}`}
        accessibilityHint="Opens the time picker."
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={() => open("time")}
        style={styles.pill}
      >
        <Text style={styles.pillText}>{time}</Text>
      </Pressable>
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    body: {
      paddingHorizontal: tokens.spacing.lg,
      paddingBottom: tokens.spacing.xl,
      gap: tokens.spacing.xs,
    },
    preview: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
      marginBottom: tokens.spacing.xs,
    },
    reason: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructiveText,
    },
    row: {
      minHeight: tokens.touch.minimum,
      flexDirection: "row",
      alignItems: "center",
    },
    rowDisabled: {
      opacity: 0.4,
    },
    rowPressed: {
      opacity: 0.7,
    },
    rowLabel: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
      flex: 1,
    },
    custom: {
      gap: tokens.spacing.sm,
      paddingBottom: tokens.spacing.sm,
    },
    whenRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
    },
    // Android's stand-in for iOS's compact pickers, in a sheet field's paint
    // (`sheetFieldStyles`), since the sheet itself is `popover`.
    pill: {
      minHeight: tokens.touch.minimum,
      justifyContent: "center",
      paddingHorizontal: tokens.spacing.md,
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tokens.color.border.control,
      backgroundColor: tokens.color.surface.surface1,
    },
    pillText: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    footnote: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
      marginTop: tokens.spacing.sm,
    },
  });
}
