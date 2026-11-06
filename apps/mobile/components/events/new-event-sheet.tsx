import { forwardRef, useCallback, useMemo, useRef, useState } from "react";
import {
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  BottomSheetModal,
  BottomSheetTextInput,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import DateTimePicker, {
  DateTimePickerAndroid,
} from "@react-native-community/datetimepicker";
import { formatWeekdayDay } from "@repo/formatting";
import { SignetTokens } from "@repo/theme/signet";
import { useCreateEvent, usePermissionList } from "@repo/hooks";
import { canAll } from "@repo/validation";
import { typeRole, useFrappTheme } from "@/lib/theme";
import {
  useChapterBranding,
  type ChapterBranding,
} from "@/lib/chapter-branding";
import {
  SheetBackToClose,
  SheetGrabber,
  SheetHeader,
  SheetPrimaryButton,
  SheetScrim,
  sheetFieldStyles,
  useSheetBackgroundStyle,
  useSheetClose,
  useSheetVisit,
} from "@/components/sheet-scaffold";
import { Toggle } from "@/components/toggle";
import {
  EVENT_NAME_MAX_LENGTH,
  emptyEventDraft,
  MINUTE_INTERVAL,
  resolveEventTimes,
  shiftEnd,
  validateNewEvent,
  withDay,
  type NewEventDraft,
  type NewEventErrors,
} from "@/lib/events/create-event";
import { formatEventClock } from "@/lib/events/format";
import { gateRefusalOf } from "@/lib/chat/gated-upload";
import { successHaptic } from "@/lib/haptics";
import { MODULE_REFUSAL_COPY } from "@/lib/module-refusal";
import { SUBSCRIPTION_REFUSAL_COPY } from "@/lib/subscription-refusal";

/**
 * The "New event" bottom sheet: an officer's quick create on the phone.
 *
 * Self-contained, so any screen can mount it and `present()` it: the Events
 * tab does today, through its floating create button, and a global create
 * menu can later. The host gates it with {@link useCanCreateEvents}.
 *
 * ## What it asks
 *
 * Name, start, end, place, points and Mandatory. The rest of the web editor
 * (description, recurrence, role targeting, the check-in zone) stays there,
 * as it does for the `/event` chat command; `lib/events/create-event.ts`
 * holds the rules. Mandatory starts off, as `/event` creates it: a mandatory
 * event marks everyone who misses it absent, so it is a choice, not a default.
 *
 * ## The platform's own pickers
 *
 * Starts and Ends are rows laid out the way Calendar's are: a day and a time,
 * each opening the system picker. On iOS they are the native compact pickers,
 * whose popovers are the calendar and the time wheel; on Android a tap opens
 * the system date or time dialog. Moving the start drags the end along,
 * keeping the event's length. Nothing is drawn by hand, so the pickers read
 * as the phone's own (owner, 2026-11-06, after a hand-drawn grid).
 *
 * ## Errors wait for Create
 *
 * Nothing is checked as the officer types. Create runs the checks and shows
 * what stops it under the field it belongs to; editing that field clears its
 * line, and nothing reappears until the next Create. The draft keeps the
 * sheets' rules (`spec/ui/mobile/patterns.md` § Bottom sheets): it outlives a
 * close, not a Cancel, and is read-only while a create runs, with Cancel held.
 */

export interface NewEventSheetProps {
  /** The host's clock, so a sheet left up overnight reads the new day. */
  now?: Date;
  /** Fired after a successful create. */
  onCreated?: () => void;
}

/**
 * The permissions `POST /v1/events` needs: the route's `events:create`, plus
 * the controller's class-level `members:view`, which `PermissionsGuard`
 * requires alongside it. Offering the button on `events:create` alone would
 * hand a custom role a sheet whose every save is refused.
 */
const CREATE_EVENT_PERMISSIONS = ["events:create", "members:view"] as const;

/** Whether the viewer may create events. */
export function useCanCreateEvents(): boolean {
  // `canAll`, not `includes`: an owner's grant is the wildcard `*`.
  return canAll(CREATE_EVENT_PERMISSIONS, usePermissionList());
}

const GATE_COPY = {
  subscription: SUBSCRIPTION_REFUSAL_COPY.event,
  module: MODULE_REFUSAL_COPY.event,
};

export const NewEventSheet = forwardRef<BottomSheetModal, NewEventSheetProps>(
  function NewEventSheet({ now, onCreated }, ref) {
    const { tokens } = useFrappTheme();
    const brand = useChapterBranding();
    const styles = createStyles(tokens, brand);
    const backgroundStyle = useSheetBackgroundStyle();
    const closeSheet = useSheetClose(ref);
    const { onAnimate, markClosed, dismiss, visit, isSameVisit } =
      useSheetVisit(ref);
    const createEvent = useCreateEvent();

    const at = useMemo(() => now ?? new Date(), [now]);
    const [draft, setDraft] = useState<NewEventDraft>(emptyEventDraft);
    const [focused, setFocused] = useState<"name" | "location" | null>(null);
    // Written by Create; a field's line goes when that field is edited.
    const [errors, setErrors] = useState<NewEventErrors>({});
    const [submitFailed, setSubmitFailed] = useState(false);
    /** A gate refusal's member copy: retrying can't win, so Create goes. */
    const [refusal, setRefusal] = useState<string | null>(null);
    const sending = useRef(false);

    const pending = createEvent.isPending;
    const { start, end } = resolveEventTimes(draft, at);
    const canSubmit = !pending && refusal === null;

    const update = useCallback(
      (patch: Partial<NewEventDraft>, clears: (keyof NewEventErrors)[]) => {
        if (pending) return;
        setDraft((previous) => ({ ...previous, ...patch }));
        setErrors((previous) => {
          if (!clears.some((key) => previous[key])) return previous;
          const next = { ...previous };
          for (const key of clears) delete next[key];
          return next;
        });
      },
      [pending],
    );

    function setStart(next: Date) {
      update({ start: next, end: shiftEnd({ start, end }, next) }, [
        "start",
        "end",
      ]);
    }
    function setEnd(next: Date) {
      update({ start, end: next }, ["end"]);
    }

    const reset = useCallback(() => {
      setDraft(emptyEventDraft());
      setFocused(null);
      setErrors({});
      setSubmitFailed(false);
      setRefusal(null);
    }, []);

    /** A swipe or scrim close: the draft stays, the visit's state goes. */
    const closed = useCallback(() => {
      markClosed();
      setFocused(null);
      setSubmitFailed(false);
      setRefusal(null);
    }, [markClosed]);

    const cancel = useCallback(() => {
      if (sending.current) return;
      reset();
      dismiss();
    }, [reset, dismiss]);

    function submit() {
      if (!canSubmit || sending.current) return;
      // Send the times on screen, read against the real clock (the host's
      // ticks every 30 seconds): an unpicked default resolved again here
      // could land on tomorrow while the sheet still shows today.
      const result = validateNewEvent({ ...draft, start, end }, new Date());
      if (!result.ok) {
        setErrors(result.errors);
        return;
      }
      sending.current = true;
      setErrors({});
      setSubmitFailed(false);
      setRefusal(null);
      Keyboard.dismiss();
      const sentFrom = visit();
      createEvent.mutate(result.body, {
        onSuccess: () => {
          sending.current = false;
          successHaptic();
          // Saved, so the draft goes whichever visit is on screen.
          reset();
          if (isSameVisit(sentFrom)) dismiss();
          onCreated?.();
        },
        onError: (error) => {
          sending.current = false;
          if (!isSameVisit(sentFrom)) return;
          const gated = gateRefusalOf(error, GATE_COPY);
          if (gated) setRefusal(gated);
          else setSubmitFailed(true);
        },
      });
    }

    return (
      <BottomSheetModal
        ref={ref}
        enableDynamicSizing
        keyboardBehavior="interactive"
        backgroundStyle={backgroundStyle}
        handleComponent={SheetGrabber}
        backdropComponent={SheetScrim}
        onAnimate={onAnimate}
        onDismiss={closed}
      >
        <SheetBackToClose onClose={closeSheet} />
        <BottomSheetView onAccessibilityEscape={closeSheet} style={styles.body}>
          <SheetHeader
            title="New event"
            onCancel={cancel}
            cancelDisabled={pending}
          />

          <View
            style={[styles.ring, focused === "name" ? styles.ringActive : null]}
          >
            <BottomSheetTextInput
              value={draft.name}
              onChangeText={(name) => update({ name }, ["name"])}
              onFocus={() => setFocused("name")}
              onBlur={() => setFocused(null)}
              editable={!pending}
              placeholder="Event name"
              placeholderTextColor={tokens.color.text.muted}
              accessibilityLabel="Event name"
              maxLength={EVENT_NAME_MAX_LENGTH}
              style={[
                styles.field,
                focused === "name" ? styles.fieldFocused : null,
                errors.name ? styles.fieldError : null,
              ]}
            />
          </View>
          {errors.name ? <Text style={styles.error}>{errors.name}</Text> : null}

          <View style={styles.group}>
            <WhenRow
              label="Starts"
              value={start}
              now={at}
              minimumDate={at}
              disabled={pending}
              onChange={setStart}
            />
            <View style={styles.groupDivider} />
            <WhenRow
              label="Ends"
              value={end}
              now={at}
              minimumDate={start}
              disabled={pending}
              onChange={setEnd}
            />
          </View>
          {errors.start ? (
            <Text style={styles.error}>{errors.start}</Text>
          ) : null}
          {errors.end ? <Text style={styles.error}>{errors.end}</Text> : null}

          <View
            style={[
              styles.ring,
              focused === "location" ? styles.ringActive : null,
            ]}
          >
            <BottomSheetTextInput
              value={draft.location}
              onChangeText={(location) => update({ location }, [])}
              onFocus={() => setFocused("location")}
              onBlur={() => setFocused(null)}
              editable={!pending}
              placeholder="Location (optional)"
              placeholderTextColor={tokens.color.text.muted}
              accessibilityLabel="Location"
              style={[
                styles.field,
                focused === "location" ? styles.fieldFocused : null,
              ]}
            />
          </View>

          <View style={styles.splitRow}>
            <View
              style={[
                styles.field,
                styles.splitField,
                errors.points ? styles.fieldError : null,
              ]}
            >
              <Text style={[styles.pointsSign, { color: brand.accent }]}>
                +
              </Text>
              <BottomSheetTextInput
                value={draft.pointsInput}
                onChangeText={(pointsInput) =>
                  update({ pointsInput }, ["points"])
                }
                editable={!pending}
                placeholder="0"
                placeholderTextColor={tokens.color.text.muted}
                accessibilityLabel="Points for attending"
                keyboardType="number-pad"
                style={styles.pointsInput}
              />
              <Text style={styles.fieldCaption}>pts</Text>
            </View>
            <View style={[styles.field, styles.splitField]}>
              <Text style={styles.fieldValue}>Mandatory</Text>
              <Toggle
                value={draft.isMandatory}
                onValueChange={(isMandatory) => update({ isMandatory }, [])}
                accessibilityLabel="Mandatory"
              />
            </View>
          </View>
          {errors.points ? (
            <Text style={styles.error}>{errors.points}</Text>
          ) : null}

          {refusal ? <Text style={styles.error}>{refusal}</Text> : null}
          {submitFailed ? (
            <Text style={styles.error}>
              That didn&apos;t save. Your event is still here, so try again.
            </Text>
          ) : null}

          <SheetPrimaryButton
            label={pending ? "Creating…" : "Create event"}
            onPress={submit}
            disabled={!canSubmit}
            accessibilityHint={refusal ?? undefined}
            accent={brand.accent}
            onAccent={tokens.color.gold.onHouse}
          />
        </BottomSheetView>
      </BottomSheetModal>
    );
  },
);

/**
 * One row of the When group: its label, then the day and the time. On iOS
 * each is the system's compact picker; elsewhere each is a pill that opens
 * the platform's dialog. `platform` is a prop so a spec can draw either.
 */
export function WhenRow({
  label,
  value,
  now,
  minimumDate,
  disabled,
  onChange,
  platform = Platform.OS,
}: {
  label: "Starts" | "Ends";
  value: Date;
  now: Date;
  minimumDate: Date;
  disabled: boolean;
  onChange: (next: Date) => void;
  platform?: string;
}) {
  const { tokens } = useFrappTheme();
  const brand = useChapterBranding();
  const styles = createStyles(tokens, brand);
  // The day may not go before the minimum's day; the time is checked on
  // Create, since a minimum time would also stop a later day's early hours.
  // A held value already below it (a kept draft whose day has passed) lowers
  // the floor to its own day: iOS draws a value under its minimum as the
  // minimum, which would show a day the draft doesn't hold.
  const floor = value < minimumDate ? value : minimumDate;
  const minimumDay = new Date(
    floor.getFullYear(),
    floor.getMonth(),
    floor.getDate(),
  );
  const day = formatWeekdayDay(value, now) ?? "";
  const time = formatEventClock(value);

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
        <Text style={styles.whenLabel}>{label}</Text>
        <View style={styles.whenPickers}>
          <DateTimePicker
            {...shared}
            mode="date"
            minimumDate={minimumDay}
            accessibilityLabel={`${label} day, ${day}`}
            onValueChange={(_event, picked) => onChange(withDay(value, picked))}
          />
          <DateTimePicker
            {...shared}
            mode="time"
            minuteInterval={MINUTE_INTERVAL}
            accessibilityLabel={`${label} time, ${time}`}
            onValueChange={(_event, picked) => onChange(withDay(picked, value))}
          />
        </View>
      </View>
    );
  }

  function open(mode: "date" | "time") {
    Keyboard.dismiss();
    DateTimePickerAndroid.open({
      value,
      mode,
      ...(mode === "date" ? { minimumDate: minimumDay } : {}),
      onValueChange: (_event, picked) =>
        onChange(
          mode === "date" ? withDay(value, picked) : withDay(picked, value),
        ),
    });
  }

  return (
    <View style={styles.whenRow}>
      <Text style={styles.whenLabel}>{label}</Text>
      <View style={styles.whenPickers}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${label} day, ${day}`}
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
          accessibilityLabel={`${label} time, ${time}`}
          accessibilityHint="Opens the time picker."
          accessibilityState={{ disabled }}
          disabled={disabled}
          onPress={() => open("time")}
          style={styles.pill}
        >
          <Text style={styles.pillText}>{time}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function createStyles(tokens: SignetTokens, brand: ChapterBranding) {
  const fieldStyles = sheetFieldStyles(tokens, brand.accent);
  return StyleSheet.create({
    body: {
      paddingHorizontal: tokens.spacing.lg,
      paddingBottom: tokens.spacing.xl,
      gap: tokens.spacing.sm,
    },
    ring: fieldStyles.ring,
    ringActive: fieldStyles.ringActive,
    field: {
      ...fieldStyles.field,
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
    },
    fieldFocused: fieldStyles.fieldFocused,
    fieldError: {
      borderColor: tokens.color.semantic.destructive,
    },
    // Starts and Ends as one grouped field, the way Calendar sets them.
    group: {
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tokens.color.border.input,
      backgroundColor: tokens.color.surface.surface1,
      paddingHorizontal: tokens.spacing.md,
    },
    groupDivider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: tokens.color.border.hairline,
    },
    whenRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      minHeight: tokens.touch.minimum + tokens.spacing.xs,
      gap: tokens.spacing.sm,
    },
    whenLabel: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    whenPickers: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
    },
    // The Android stand-in for iOS's compact pill: a quiet chip, tappable.
    pill: {
      minHeight: 34,
      justifyContent: "center",
      paddingHorizontal: tokens.spacing.md,
      borderRadius: tokens.radius.chip,
      backgroundColor: tokens.color.surface.popover,
    },
    pillText: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    splitRow: {
      flexDirection: "row",
      gap: tokens.spacing.sm,
    },
    splitField: {
      flex: 1,
    },
    fieldValue: {
      flex: 1,
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    fieldCaption: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
    },
    pointsSign: {
      ...typeRole(tokens.typography.role.label),
    },
    pointsInput: {
      flex: 1,
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    error: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructive,
    },
  });
}
