import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { BottomSheetModal, BottomSheetView } from "@gorhom/bottom-sheet";
import DateTimePicker, {
  DateTimePickerAndroid,
} from "@react-native-community/datetimepicker";
import { formatTimeOfDay } from "@repo/formatting";
import {
  MESSAGE_REMINDER_LABEL,
  MESSAGE_REMINDER_PRESETS,
  messageReminderPresetTime,
} from "@repo/hooks/use-message-reminders";
import { SignetTokens } from "@repo/theme/signet";
import { ListRow, ListSection } from "@/components/list-section";
import {
  SheetBackToClose,
  SheetGrabber,
  SheetHeader,
  SheetPrimaryButton,
  SheetScrim,
  useSheetBackgroundStyle,
  useSheetClose,
  useSheetVisit,
} from "@/components/sheet-scaffold";
import { useChapterBranding } from "@/lib/chapter-branding";
import {
  reminderAtLabel,
  reminderPresetValue,
} from "@/lib/chat/message-reminder";
import { typeRole, useFrappTheme } from "@/lib/theme";

/** The last row, which opens the platform's date and time picker. */
export const REMINDER_CUSTOM_LABEL = "Custom…";
/** The custom step's title and its button. */
export const REMINDER_CUSTOM_TITLE = "Pick a date and time";
export const REMINDER_SET_LABEL = "Set reminder";
/** Said under the pickers, and on Android, for a time already gone. */
export const REMINDER_PAST_NOTE = "Pick a time later than now.";

/** The furthest out the API takes a reminder (a year), less a minute's slack. */
const REMINDER_MAX_AHEAD_MS = 365 * 24 * 60 * 60_000 - 60_000;

/** The next whole hour from now: where the custom picker starts. */
function nextWholeHour(now: Date): Date {
  const at = new Date(now);
  at.setMinutes(0, 0, 0);
  at.setHours(at.getHours() + 1);
  return at;
}

/** `day`'s date with `clock`'s hours and minutes. */
function withClock(day: Date, clock: Date): Date {
  const at = new Date(day);
  at.setHours(clock.getHours(), clock.getMinutes(), 0, 0);
  return at;
}

export interface RemindSheetHandle {
  present: () => void;
  /** Closes the sheet, only while it is up (`useSheetVisit`, #3795). */
  dismiss: () => void;
}

export interface RemindSheetProps {
  messageId: string | null;
  /** Sets the reminder; the caller confirms it or says why it failed. */
  onRemind: (messageId: string, remindAt: Date) => void;
  /** A stand-in for `Platform.OS`, so a spec can draw either picker. */
  platform?: string;
}

/**
 * "Remind me about this" (#4957): when to bring the message back. Slack's
 * presets (`MESSAGE_REMINDER_PRESETS`, in 20 minutes through next week), each
 * with the time it lands on, then "Custom…", the platform's own date and time
 * picker (`components.md` § Time and date pickers): on iOS the compact pickers
 * in a second step of this sheet, on Android the system's date dialog then
 * its time dialog, as the New task sheet's due fields open them.
 *
 * **It replaces the actions menu** (`stackBehavior="replace"`), as the Forward
 * picker and the report form do, presented by the menu itself, so closing it
 * returns to the thread (`forward-sheet.tsx` says why).
 */
export const RemindSheet = forwardRef<RemindSheetHandle, RemindSheetProps>(
  function RemindSheet({ messageId, onRemind, platform = Platform.OS }, ref) {
    const { tokens } = useFrappTheme();
    const { accent } = useChapterBranding();
    const styles = createStyles(tokens);
    const backgroundStyle = useSheetBackgroundStyle();
    const modalRef = useRef<BottomSheetModal>(null);
    const close = useSheetClose(modalRef);
    const visit = useSheetVisit(modalRef);
    const { dismiss, willPresent } = visit;
    // Read when the sheet opens and on each step, so the presets' times are
    // the ones they will set.
    const [now, setNow] = useState(() => new Date());
    const [custom, setCustom] = useState<Date | null>(null);
    /** Android's dialogs came back with a time already gone. */
    const [pastNote, setPastNote] = useState(false);

    useImperativeHandle(
      ref,
      () => ({
        present: () => {
          setNow(new Date());
          setCustom(null);
          setPastNote(false);
          willPresent();
          modalRef.current?.present();
        },
        dismiss,
      }),
      [dismiss, willPresent],
    );

    const remind = useCallback(
      (at: Date) => {
        if (!messageId) return;
        close();
        onRemind(messageId, at);
      },
      [close, messageId, onRemind],
    );

    const latest = new Date(now.getTime() + REMINDER_MAX_AHEAD_MS);

    const openCustom = () => {
      const opened = new Date();
      setNow(opened);
      const start = nextWholeHour(opened);
      if (platform === "ios") {
        setCustom(start);
        return;
      }
      // Android asks the day, then the time; a dialog dismissed at either
      // step sets nothing.
      DateTimePickerAndroid.open({
        value: start,
        mode: "date",
        minimumDate: opened,
        maximumDate: new Date(opened.getTime() + REMINDER_MAX_AHEAD_MS),
        onValueChange: (_event, day) => {
          DateTimePickerAndroid.open({
            value: withClock(day, start),
            mode: "time",
            onValueChange: (_timeEvent, clock) => {
              const at = withClock(day, clock);
              if (at.getTime() <= Date.now()) {
                // Nothing to set: the member picked a time already gone.
                setPastNote(true);
                return;
              }
              setPastNote(false);
              remind(at);
            },
          });
        },
      });
    };
    const customPast = custom !== null && custom.getTime() <= now.getTime();

    return (
      <BottomSheetModal
        ref={modalRef}
        stackBehavior="replace"
        enableDynamicSizing
        backgroundStyle={backgroundStyle}
        handleComponent={SheetGrabber}
        backdropComponent={SheetScrim}
        onAnimate={visit.onAnimate}
        onDismiss={() => {
          visit.markClosed();
          setCustom(null);
          setPastNote(false);
        }}
      >
        <SheetBackToClose onClose={close} />
        <BottomSheetView onAccessibilityEscape={close} style={styles.body}>
          {custom ? (
            <>
              <SheetHeader
                title={REMINDER_CUSTOM_TITLE}
                onCancel={() => setCustom(null)}
              />
              <View style={styles.pickers}>
                <DateTimePicker
                  value={custom}
                  mode="date"
                  display="compact"
                  themeVariant="dark"
                  accentColor={accent}
                  minimumDate={now}
                  maximumDate={latest}
                  accessibilityLabel={`Day, ${reminderAtLabel(custom, now)}`}
                  onValueChange={(_event, day) => {
                    setNow(new Date());
                    setCustom(withClock(day, custom));
                  }}
                />
                <DateTimePicker
                  value={custom}
                  mode="time"
                  display="compact"
                  themeVariant="dark"
                  accentColor={accent}
                  accessibilityLabel={`Time, ${formatTimeOfDay(custom.toISOString())}`}
                  onValueChange={(_event, clock) => {
                    setNow(new Date());
                    setCustom(withClock(custom, clock));
                  }}
                />
              </View>
              {customPast ? (
                <Text style={styles.note} accessibilityLiveRegion="polite">
                  {REMINDER_PAST_NOTE}
                </Text>
              ) : null}
              <SheetPrimaryButton
                label={REMINDER_SET_LABEL}
                onPress={() => {
                  if (!customPast) remind(custom);
                }}
                disabled={customPast}
                accessibilityHint={customPast ? REMINDER_PAST_NOTE : undefined}
                accent={accent}
                onAccent={tokens.color.gold.onHouse}
              />
            </>
          ) : (
            <>
              <SheetHeader title={MESSAGE_REMINDER_LABEL} />
              <ListSection>
                {MESSAGE_REMINDER_PRESETS.map((preset) => {
                  const at = messageReminderPresetTime(preset.id, now);
                  return (
                    <ListRow
                      key={preset.id}
                      label={preset.label}
                      value={reminderPresetValue(at, now)}
                      action
                      accessibilityHint={`Reminds you ${reminderAtLabel(at, now)}.`}
                      onPress={() =>
                        remind(messageReminderPresetTime(preset.id, new Date()))
                      }
                    />
                  );
                })}
                <ListRow
                  label={REMINDER_CUSTOM_LABEL}
                  action
                  accessibilityHint="Opens a date and time picker."
                  onPress={openCustom}
                />
              </ListSection>
              {pastNote ? (
                <Text style={styles.note} accessibilityLiveRegion="polite">
                  {REMINDER_PAST_NOTE}
                </Text>
              ) : null}
            </>
          )}
        </BottomSheetView>
      </BottomSheetModal>
    );
  },
);

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    body: {
      paddingHorizontal: tokens.spacing.lg,
      paddingBottom: tokens.spacing.xl,
      gap: tokens.spacing.md,
    },
    pickers: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
    },
    note: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
  });
}
