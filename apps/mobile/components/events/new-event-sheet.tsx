import {
  forwardRef,
  useCallback,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Keyboard, Pressable, StyleSheet, Text, View } from "react-native";
import {
  BottomSheetModal,
  BottomSheetTextInput,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import { SignetTokens } from "@repo/theme/signet";
import { useCreateEvent, usePermissionList } from "@repo/hooks";
import { can } from "@repo/validation";
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
import { CalendarGlyph } from "@/components/tasks/task-glyphs";
import { DayCalendar, TimeGrid } from "@/components/events/event-when-pickers";
import {
  emptyEventDraft,
  endsNextDay,
  formatClock,
  formatEventDay,
  resolveEventDate,
  shiftEnd,
  validateNewEvent,
  type NewEventDraft,
  type NewEventErrors,
} from "@/lib/events/create-event";
import { TITLE_MAX_LENGTH } from "@/lib/tasks/limits";
import { successHaptic } from "@/lib/haptics";
import { MODULE_REFUSAL_COPY, moduleRefusalOf } from "@/lib/module-refusal";
import {
  SUBSCRIPTION_REFUSAL_COPY,
  subscriptionRefusalOf,
} from "@/lib/subscription-refusal";

/**
 * The "New event" bottom sheet: an officer's quick create on the phone.
 *
 * Self-contained, so any screen can mount it and `present()` it: the Events
 * tab does today, through its floating create button, and a global create
 * menu can later. The host gates it with {@link useCanCreateEvents}.
 *
 * ## What it asks
 *
 * Name, day, start, end, place, points and Mandatory. The rest of the web
 * editor (description, recurrence, role targeting, the check-in zone) stays
 * there, as it does for the `/event` chat command; `lib/events/create-event.ts`
 * holds the rules. Mandatory starts off, as `/event` creates it: a mandatory
 * event marks everyone who misses it absent, so it is a choice, not a default.
 *
 * ## One picker at a time, under its field
 *
 * The day and the two times are fields that read back what is picked. A tap
 * opens that field's picker under it and closes any other, and a second tap
 * closes it, so the sheet never shows every option at once. Moving the start
 * moves the end with it, keeping the event's length. An end before the start
 * is the next morning, and the field says so.
 *
 * ## Errors wait for Create
 *
 * Nothing is checked per keystroke. Create runs the checks and shows what
 * stops it under the field it belongs to; from then on an error clears as
 * soon as the field is fixed. The draft keeps the sheets' rules
 * (`spec/ui/mobile/patterns.md` § Bottom sheets): it outlives a close, not a
 * Cancel, and is read-only while a create runs, with Cancel held.
 */

export interface NewEventSheetProps {
  /** The host's clock, so a sheet left up overnight reads the new day. */
  now?: Date;
  /** Fired after a successful create. */
  onCreated?: () => void;
}

/** Whether the viewer may create events (`POST /v1/events`). */
export function useCanCreateEvents(): boolean {
  // `can`, not `includes`: an owner's grant is the wildcard `*`.
  return can("events:create", usePermissionList());
}

type Panel = "date" | "start" | "end";

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
    const [draft, setDraft] = useState<NewEventDraft>(() =>
      emptyEventDraft(at),
    );
    const [panel, setPanel] = useState<Panel | null>(null);
    const [focused, setFocused] = useState<"name" | "location" | null>(null);
    // Set by Create; until then nothing reads as wrong.
    const [showErrors, setShowErrors] = useState(false);
    const [submitFailed, setSubmitFailed] = useState(false);
    /** A gate refusal's member copy: retrying can't win, so Create goes. */
    const [refusal, setRefusal] = useState<string | null>(null);
    const sending = useRef(false);

    const pending = createEvent.isPending;
    // A kept draft whose day has passed falls back to the default day.
    const date = resolveEventDate(draft.date, at);
    const current = { ...draft, date };
    const result = validateNewEvent(current);
    const errors: NewEventErrors =
      showErrors && !result.ok ? result.errors : {};
    const canSubmit = !pending && refusal === null;

    const update = useCallback(
      (patch: Partial<NewEventDraft>) => {
        if (pending) return;
        setDraft((previous) => ({ ...previous, ...patch }));
      },
      [pending],
    );

    function togglePanel(next: Panel) {
      if (pending) return;
      Keyboard.dismiss();
      setPanel((open) => (open === next ? null : next));
    }

    const reset = useCallback(() => {
      setDraft(emptyEventDraft(new Date()));
      setPanel(null);
      setFocused(null);
      setShowErrors(false);
      setSubmitFailed(false);
      setRefusal(null);
    }, []);

    /** A swipe or scrim close: the draft stays, the visit's state goes. */
    const closed = useCallback(() => {
      markClosed();
      setPanel(null);
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
      setShowErrors(true);
      if (!result.ok) {
        setPanel(null);
        return;
      }
      sending.current = true;
      setSubmitFailed(false);
      setRefusal(null);
      setPanel(null);
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
          if (subscriptionRefusalOf(error)) {
            setRefusal(SUBSCRIPTION_REFUSAL_COPY.event);
            return;
          }
          if (moduleRefusalOf(error)) {
            setRefusal(MODULE_REFUSAL_COPY.event);
            return;
          }
          setSubmitFailed(true);
        },
      });
    }

    const nextDay = endsNextDay(draft.start, draft.end);

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
              onChangeText={(name) => update({ name })}
              onFocus={() => {
                setFocused("name");
                setPanel(null);
              }}
              onBlur={() => setFocused(null)}
              editable={!pending}
              placeholder="Chapter meeting"
              placeholderTextColor={tokens.color.text.muted}
              accessibilityLabel="Event name"
              maxLength={TITLE_MAX_LENGTH}
              style={[
                styles.field,
                focused === "name" ? styles.fieldFocused : null,
                errors.name ? styles.fieldError : null,
              ]}
            />
          </View>
          {errors.name ? <Text style={styles.error}>{errors.name}</Text> : null}

          <FieldButton
            accessibilityLabel={`Day: ${formatEventDay(date)}`}
            accessibilityHint="Choose the day."
            open={panel === "date"}
            disabled={pending}
            onPress={() => togglePanel("date")}
          >
            <CalendarGlyph color={tokens.color.text.mutedForeground} />
            <Text style={styles.fieldValue}>{formatEventDay(date)}</Text>
          </FieldButton>
          {panel === "date" ? (
            <DayCalendar
              value={date}
              now={at}
              onChange={(picked) => {
                update({ date: picked });
                setPanel(null);
              }}
            />
          ) : null}

          <View style={styles.splitRow}>
            <FieldButton
              accessibilityLabel={`Starts ${formatClock(draft.start)}`}
              accessibilityHint="Choose the start time."
              open={panel === "start"}
              disabled={pending}
              onPress={() => togglePanel("start")}
              invalid={Boolean(errors.time)}
              flex
            >
              <Text style={styles.fieldCaption}>Starts</Text>
              <Text style={styles.fieldValue}>{formatClock(draft.start)}</Text>
            </FieldButton>
            <FieldButton
              accessibilityLabel={`Ends ${formatClock(draft.end)}${
                nextDay ? ", the next day" : ""
              }`}
              accessibilityHint="Choose the end time."
              open={panel === "end"}
              disabled={pending}
              onPress={() => togglePanel("end")}
              invalid={Boolean(errors.time)}
              flex
            >
              <Text style={styles.fieldCaption}>Ends</Text>
              <Text style={styles.fieldValue}>{formatClock(draft.end)}</Text>
              {nextDay ? <Text style={styles.fieldCaption}>+1 day</Text> : null}
            </FieldButton>
          </View>
          {panel === "start" ? (
            <TimeGrid
              label="Start time"
              value={draft.start}
              onChange={(start) =>
                update({ start, end: shiftEnd(draft.start, draft.end, start) })
              }
            />
          ) : null}
          {panel === "end" ? (
            <TimeGrid
              label="End time"
              value={draft.end}
              onChange={(end) => update({ end })}
            />
          ) : null}
          {errors.time ? <Text style={styles.error}>{errors.time}</Text> : null}

          <View
            style={[
              styles.ring,
              focused === "location" ? styles.ringActive : null,
            ]}
          >
            <BottomSheetTextInput
              value={draft.location}
              onChangeText={(location) => update({ location })}
              onFocus={() => {
                setFocused("location");
                setPanel(null);
              }}
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
                onChangeText={(pointsInput) => update({ pointsInput })}
                onFocus={() => setPanel(null)}
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
                onValueChange={(isMandatory) => update({ isMandatory })}
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
 * A field that opens a picker rather than taking text. Open, it wears the
 * focus border a text field does, so the field and its picker read as one.
 */
function FieldButton({
  open,
  disabled,
  invalid = false,
  flex = false,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  children,
}: {
  open: boolean;
  disabled: boolean;
  invalid?: boolean;
  flex?: boolean;
  onPress: () => void;
  accessibilityLabel: string;
  accessibilityHint: string;
  children: ReactNode;
}) {
  const { tokens } = useFrappTheme();
  const brand = useChapterBranding();
  const styles = createStyles(tokens, brand);
  return (
    <View
      style={[
        styles.ring,
        open ? styles.ringActive : null,
        flex ? styles.splitField : null,
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        accessibilityState={{ expanded: open, disabled }}
        disabled={disabled}
        onPress={onPress}
        style={[
          styles.field,
          open ? styles.fieldFocused : null,
          invalid ? styles.fieldError : null,
        ]}
      >
        {children}
      </Pressable>
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
