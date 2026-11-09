import { forwardRef, useCallback, useMemo, useRef, useState } from "react";
import {
  Alert,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetTextInput,
} from "@gorhom/bottom-sheet";
import DateTimePicker, {
  DateTimePickerAndroid,
} from "@react-native-community/datetimepicker";
import { formatWeekdayDay } from "@repo/formatting";
import { SignetTokens } from "@repo/theme/signet";
import {
  useCreateEvent,
  useDeleteEvent,
  usePermissionList,
  useRoles,
  useUpdateEvent,
} from "@repo/hooks";
import {
  RECURRENCE_REPEAT_LABELS,
  RECURRENCE_RULES,
  canAll,
  describeAttendance,
  isRecurrenceRule,
} from "@repo/validation";
import { fieldTypeRole, typeRole, useFrappTheme } from "@/lib/theme";
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
import { FilterChips } from "@/components/filter-chips";
import { MoreOptionsRow } from "@/components/more-options-row";
import { DisclosureGlyph } from "@/components/control-glyphs";
import { AttendanceSheet } from "@/components/events/attendance-sheet";
import { roleOptionsFrom } from "@/lib/events/attendance-roles";
import {
  EVENT_NAME_MAX_LENGTH,
  emptyEventDraft,
  MINUTE_INTERVAL,
  moreOptionsSummary,
  repeatCaption,
  resolveEventTimes,
  shiftEnd,
  validateNewEvent,
  withDay,
  type NewEventDraft,
  type NewEventErrors,
} from "@/lib/events/create-event";
import {
  DELETE_EVENT_PERMISSIONS,
  EDIT_EVENT_PERMISSIONS,
  draftFromEvent,
  isEmptyPatch,
  leavesAfterSave,
  offersSeriesChoice,
  saveRequestFor,
  saveScopeFor,
  validateEventEdit,
  type EventEditScope,
  type EventEditTarget,
} from "@/lib/events/edit-event";
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
 * It opens simple: name, start, end and place, the four things every event
 * needs. "More options" holds the rest, and says in one line what they are
 * set to while closed: who's coming (by role, in its own stacked sheet,
 * `attendance-sheet.tsx`), points, Repeat and a description. The check-in
 * zone stays on the web editor. `lib/events/create-event.ts` holds the rules.
 * Attendance starts optional for everyone, as `/event` creates it: a required
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
 * ## Editing
 *
 * Passed `editing`, the same sheet edits that event: "Edit event", the form
 * filled from it, Save changes, and Delete event at the foot for a viewer who
 * may delete. A repeating event asks on save whether the change is for this
 * event or every upcoming one, as Calendar does. `lib/events/edit-event.ts`
 * holds what is sent and where.
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
  /** Set to edit this event instead of creating one. */
  editing?: EventEditTarget;
  /**
   * Fired after an edit saves. `leave` says the event on screen may have been
   * replaced by the save, so the host should go back to the list.
   */
  onSaved?: (result: { leave: boolean }) => void;
  /** Fired after the event is deleted from the sheet. */
  onDeleted?: () => void;
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

/** Whether the viewer may edit, and delete, any event in the chapter. */
export function useEventEditGrants(): { edit: boolean; delete: boolean } {
  const permissions = usePermissionList();
  return {
    edit: canAll(EDIT_EVENT_PERMISSIONS, permissions),
    delete: canAll(DELETE_EVENT_PERMISSIONS, permissions),
  };
}

/** A 400: the request itself is refused, so a retry fails the same way. */
function isBadRequest(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    (error as { statusCode?: unknown }).statusCode === 400
  );
}

/**
 * Calendar's question for a repeating event, as the platform's own alert.
 * Resolves `null` on Cancel.
 */
function askSeriesScope(copy: {
  title: string;
  message: string;
  seriesDestructive?: boolean;
}): Promise<EventEditScope | null> {
  return new Promise((resolve) => {
    Alert.alert(
      copy.title,
      copy.message,
      [
        { text: "This event only", onPress: () => resolve("instance") },
        {
          text: "All upcoming events",
          style: copy.seriesDestructive ? "destructive" : "default",
          onPress: () => resolve("series"),
        },
        { text: "Cancel", style: "cancel", onPress: () => resolve(null) },
      ],
      { cancelable: true, onDismiss: () => resolve(null) },
    );
  });
}

const GATE_COPY = {
  subscription: SUBSCRIPTION_REFUSAL_COPY.event,
  module: MODULE_REFUSAL_COPY.event,
};

export const NewEventSheet = forwardRef<BottomSheetModal, NewEventSheetProps>(
  function NewEventSheet({ now, onCreated, editing, onSaved, onDeleted }, ref) {
    const { tokens } = useFrappTheme();
    const brand = useChapterBranding();
    const styles = createStyles(tokens, brand);
    const backgroundStyle = useSheetBackgroundStyle();
    const closeSheet = useSheetClose(ref);
    const { onAnimate, markClosed, dismiss, visit, isSameVisit } =
      useSheetVisit(ref);
    const createEvent = useCreateEvent();
    const updateEvent = useUpdateEvent();
    const deleteEvent = useDeleteEvent();
    const grants = useEventEditGrants();
    const attendanceRef = useRef<BottomSheetModal>(null);
    const rolesQuery = useRoles();
    const roleName = useMemo(() => {
      const byId = new Map(
        roleOptionsFrom(rolesQuery.data).map((role) => [role.id, role.name]),
      );
      return (id: string) => byId.get(id);
    }, [rolesQuery.data]);

    const at = useMemo(() => now ?? new Date(), [now]);
    const freshDraft = useCallback(
      () => (editing ? draftFromEvent(editing) : emptyEventDraft()),
      [editing],
    );
    const [draft, setDraft] = useState<NewEventDraft>(freshDraft);
    const [focused, setFocused] = useState<
      "name" | "location" | "points" | "checkInOpens" | "description" | null
    >(null);
    // Written by Create; a field's line goes when that field is edited.
    const [errors, setErrors] = useState<NewEventErrors>({});
    const [submitFailed, setSubmitFailed] = useState(false);
    /** A gate refusal's member copy: retrying can't win, so Create goes. */
    const [refusal, setRefusal] = useState<string | null>(null);
    /**
     * The server refused this exact change (a 400): Save stays, since a
     * different change can win, and editing anything clears the line.
     */
    const [rejected, setRejected] = useState<string | null>(null);
    const sending = useRef(false);

    const pending =
      createEvent.isPending || updateEvent.isPending || deleteEvent.isPending;
    const { start, end } = resolveEventTimes(draft, at);
    // An event already under way may keep its start, so the pickers' floor
    // is the earlier of now and where it starts.
    const originalStart = editing ? new Date(editing.event.start_time) : null;
    const startFloor = originalStart && originalStart < at ? originalStart : at;
    const canSubmit = !pending && refusal === null;

    const update = useCallback(
      (patch: Partial<NewEventDraft>, clears: (keyof NewEventErrors)[]) => {
        if (pending) return;
        setDraft((previous) => ({ ...previous, ...patch }));
        setRejected(null);
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
      setDraft(freshDraft());
      setFocused(null);
      setErrors({});
      setSubmitFailed(false);
      setRefusal(null);
      setRejected(null);
    }, [freshDraft]);

    /** A swipe or scrim close: the draft stays, the visit's state goes. */
    const closed = useCallback(() => {
      markClosed();
      setFocused(null);
      setSubmitFailed(false);
      setRefusal(null);
      setRejected(null);
    }, [markClosed]);

    const cancel = useCallback(() => {
      if (sending.current) return;
      reset();
      dismiss();
    }, [reset, dismiss]);

    async function saveEdit(target: EventEditTarget) {
      const result = validateEventEdit(
        { ...draft, start, end },
        target,
        new Date(),
      );
      if (!result.ok) {
        setErrors(result.errors);
        if (
          result.errors.points ||
          result.errors.checkInOpens ||
          result.errors.attendance
        ) {
          setDraft((previous) => ({ ...previous, showMore: true }));
        }
        return;
      }
      setErrors({});
      // Nothing changed: there is nothing to send, and nobody to notify.
      if (isEmptyPatch(result.patch)) {
        reset();
        dismiss();
        return;
      }
      Keyboard.dismiss();
      let scope = saveScopeFor(target, result.patch, new Date());
      if (scope === "ask") {
        sending.current = true;
        const picked = await askSeriesScope({
          title: "This is a repeating event",
          message:
            "Save your changes to this event only, or to every upcoming event in the series?",
        });
        sending.current = false;
        if (!picked) return;
        scope = picked;
      }
      const request = saveRequestFor(target, result.patch, scope);
      sending.current = true;
      setRejected(null);
      setSubmitFailed(false);
      setRefusal(null);
      const sentFrom = visit();
      updateEvent.mutate(
        { id: request.id, body: { ...request.body, scope: request.scope } },
        {
          onSuccess: (saved) => {
            sending.current = false;
            successHaptic();
            const savedId =
              saved && typeof saved === "object" && "id" in saved
                ? String((saved as { id: unknown }).id)
                : null;
            if (isSameVisit(sentFrom)) dismiss();
            onSaved?.({ leave: leavesAfterSave(request, target, savedId) });
          },
          onError: (error) => {
            sending.current = false;
            if (!isSameVisit(sentFrom)) return;
            const gated = gateRefusalOf(error, GATE_COPY);
            if (gated) setRefusal(gated);
            else if (isBadRequest(error)) {
              // Sending it again can't win, so say what to do instead.
              setRejected(
                request.scope === "series"
                  ? "That change can't be made to the whole series. Save it to this event only, or open the next event and change that."
                  : "That change can't be saved. Check the times and try something else.",
              );
            } else setSubmitFailed(true);
          },
        },
      );
    }

    async function confirmDelete(target: EventEditTarget) {
      if (pending || sending.current) return;
      Keyboard.dismiss();
      let scope: EventEditScope | null;
      sending.current = true;
      if (offersSeriesChoice(target, new Date())) {
        scope = await askSeriesScope({
          title: "Delete a repeating event",
          message:
            "Delete this event only, or every upcoming event in the series? Events that already happened stay.",
          seriesDestructive: true,
        });
      } else {
        scope = await new Promise<EventEditScope | null>((resolve) => {
          Alert.alert(
            "Delete this event?",
            "It comes off the chapter's calendar for everyone.",
            [
              { text: "Cancel", style: "cancel", onPress: () => resolve(null) },
              {
                text: "Delete",
                style: "destructive",
                onPress: () => resolve("instance"),
              },
            ],
            { cancelable: true, onDismiss: () => resolve(null) },
          );
        });
      }
      sending.current = false;
      if (!scope) return;
      sending.current = true;
      setSubmitFailed(false);
      setRefusal(null);
      const sentFrom = visit();
      deleteEvent.mutate(
        { id: target.event.id, scope },
        {
          onSuccess: () => {
            sending.current = false;
            successHaptic();
            if (isSameVisit(sentFrom)) dismiss();
            onDeleted?.();
          },
          onError: (error) => {
            sending.current = false;
            if (!isSameVisit(sentFrom)) return;
            const gated = gateRefusalOf(error, GATE_COPY);
            if (gated) setRefusal(gated);
            else setSubmitFailed(true);
          },
        },
      );
    }

    function submit() {
      if (!canSubmit || sending.current) return;
      if (editing) {
        void saveEdit(editing);
        return;
      }
      // Send the times on screen, read against the real clock (the host's
      // ticks every 30 seconds): an unpicked default resolved again here
      // could land on tomorrow while the sheet still shows today.
      const result = validateNewEvent({ ...draft, start, end }, new Date());
      if (!result.ok) {
        setErrors(result.errors);
        // An error inside the closed options would otherwise say nothing.
        if (
          result.errors.points ||
          result.errors.checkInOpens ||
          result.errors.attendance
        ) {
          setDraft((previous) => ({ ...previous, showMore: true }));
        }
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

    // An existing series' length was set when it was made; the line comes
    // back only when the officer changes Repeat and the series is rebuilt.
    const repeatNote =
      editing && draft.recurrenceRule === editing.seriesRule
        ? null
        : repeatCaption(start, draft.recurrenceRule);
    const repeatUnknown =
      !!editing?.event.parent_event_id && editing.parent === null;

    return (
      <>
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
          <BottomSheetScrollView
            onAccessibilityEscape={closeSheet}
            contentContainerStyle={styles.body}
            keyboardShouldPersistTaps="handled"
          >
            <SheetHeader
              title={editing ? "Edit event" : "New event"}
              onCancel={cancel}
              cancelDisabled={pending}
            />

            <View
              style={[
                styles.ring,
                focused === "name" ? styles.ringActive : null,
              ]}
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
            {errors.name ? (
              <Text style={styles.error}>{errors.name}</Text>
            ) : null}

            <View style={styles.group}>
              <WhenRow
                label="Starts"
                value={start}
                now={at}
                minimumDate={startFloor}
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

            <MoreOptionsRow
              open={draft.showMore}
              summary={moreOptionsSummary(draft, roleName)}
              onToggle={() => {
                Keyboard.dismiss();
                update({ showMore: !draft.showMore }, []);
              }}
            />

            {draft.showMore ? (
              <View style={styles.more}>
                <View style={styles.group}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Who's coming: ${describeAttendance(draft.attendance, roleName)}`}
                    accessibilityHint="Sets who must attend, by role."
                    accessibilityState={{ disabled: pending }}
                    disabled={pending}
                    onPress={() => {
                      Keyboard.dismiss();
                      attendanceRef.current?.present();
                    }}
                    style={styles.optionRow}
                  >
                    <Text style={styles.optionLabel}>Who&apos;s coming</Text>
                    <Text style={styles.optionValue} numberOfLines={1}>
                      {describeAttendance(draft.attendance, roleName)}
                    </Text>
                    <DisclosureGlyph
                      color={tokens.color.text.muted}
                      size={16}
                      direction="right"
                    />
                  </Pressable>
                  <View style={styles.groupDivider} />
                  <View style={styles.optionRow}>
                    <Text style={styles.optionLabel}>Points for attending</Text>
                    <BottomSheetTextInput
                      value={draft.pointsInput}
                      onChangeText={(pointsInput) =>
                        update({ pointsInput }, ["points"])
                      }
                      onFocus={() => setFocused("points")}
                      onBlur={() => setFocused(null)}
                      editable={!pending}
                      placeholder="0"
                      placeholderTextColor={tokens.color.text.muted}
                      accessibilityLabel="Points for attending"
                      keyboardType="number-pad"
                      selectTextOnFocus
                      style={[
                        styles.pointsInput,
                        focused === "points" ? styles.fieldFocused : null,
                        errors.points ? styles.fieldError : null,
                      ]}
                    />
                  </View>
                  <View style={styles.groupDivider} />
                  {/* #3703: members arrive early, so check-in opens ahead
                      of the start; 10 minutes unless the officer says. */}
                  <View style={styles.optionRow}>
                    <Text style={styles.optionLabel}>
                      Check-in opens (min early)
                    </Text>
                    <BottomSheetTextInput
                      value={draft.checkInOpensInput}
                      onChangeText={(checkInOpensInput) =>
                        update({ checkInOpensInput }, ["checkInOpens"])
                      }
                      onFocus={() => setFocused("checkInOpens")}
                      onBlur={() => setFocused(null)}
                      editable={!pending}
                      placeholder="10"
                      placeholderTextColor={tokens.color.text.muted}
                      accessibilityLabel="Minutes before the start that check-in opens"
                      keyboardType="number-pad"
                      selectTextOnFocus
                      style={[
                        styles.pointsInput,
                        focused === "checkInOpens" ? styles.fieldFocused : null,
                        errors.checkInOpens ? styles.fieldError : null,
                      ]}
                    />
                  </View>
                </View>
                {errors.attendance ? (
                  <Text style={styles.error}>{errors.attendance}</Text>
                ) : null}
                {errors.points ? (
                  <Text style={styles.error}>{errors.points}</Text>
                ) : null}
                {errors.checkInOpens ? (
                  <Text style={styles.error}>{errors.checkInOpens}</Text>
                ) : null}

                {/* A generated occurrence whose series couldn't be read
                    doesn't know its rule, so it doesn't offer to change it. */}
                {repeatUnknown ? null : (
                  <>
                    <Text style={styles.sectionLabel}>Repeat</Text>
                    <FilterChips
                      chips={REPEAT_CHIPS}
                      selected={draft.recurrenceRule ?? NEVER}
                      onSelect={(value) =>
                        update(
                          {
                            recurrenceRule: isRecurrenceRule(value)
                              ? value
                              : null,
                          },
                          [],
                        )
                      }
                      accessibilityLabel="Repeat"
                    />
                    {repeatNote ? (
                      <Text style={styles.caption}>{repeatNote}</Text>
                    ) : null}
                  </>
                )}

                <View
                  style={[
                    styles.ring,
                    focused === "description" ? styles.ringActive : null,
                  ]}
                >
                  <BottomSheetTextInput
                    value={draft.description}
                    onChangeText={(description) => update({ description }, [])}
                    onFocus={() => setFocused("description")}
                    onBlur={() => setFocused(null)}
                    editable={!pending}
                    placeholder="Description (optional)"
                    placeholderTextColor={tokens.color.text.muted}
                    accessibilityLabel="Description"
                    multiline
                    style={[
                      styles.field,
                      styles.fieldMultiline,
                      focused === "description" ? styles.fieldFocused : null,
                    ]}
                  />
                </View>
              </View>
            ) : null}

            {refusal ? <Text style={styles.error}>{refusal}</Text> : null}
            {rejected ? <Text style={styles.error}>{rejected}</Text> : null}
            {submitFailed ? (
              <Text style={styles.error}>
                That didn&apos;t save. Your{" "}
                {editing ? "changes are" : "event is"} still here, so try again.
              </Text>
            ) : null}

            <SheetPrimaryButton
              label={
                editing
                  ? updateEvent.isPending
                    ? "Saving…"
                    : "Save changes"
                  : pending
                    ? "Creating…"
                    : "Create event"
              }
              onPress={submit}
              disabled={!canSubmit}
              accessibilityHint={refusal ?? undefined}
              accent={brand.accent}
              onAccent={tokens.color.gold.onHouse}
            />

            {editing && grants.delete ? (
              // Quiet, and last: a couple of taps away and never next to Save.
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Delete event"
                accessibilityState={{ disabled: pending }}
                disabled={pending}
                onPress={() => void confirmDelete(editing)}
                style={styles.deleteRow}
              >
                <Text style={styles.deleteText}>
                  {deleteEvent.isPending ? "Deleting…" : "Delete event"}
                </Text>
              </Pressable>
            ) : null}
          </BottomSheetScrollView>
        </BottomSheetModal>

        <AttendanceSheet
          ref={attendanceRef}
          value={draft.attendance}
          onChange={(attendance) => update({ attendance }, ["attendance"])}
        />
      </>
    );
  },
);

/** The Repeat chips: one-time first, then the rules the API generates. */
const NEVER = "never";
const REPEAT_CHIPS = [
  { value: NEVER, label: "Never" },
  ...RECURRENCE_RULES.map((rule) => ({
    value: rule,
    label: RECURRENCE_REPEAT_LABELS[rule],
  })),
];

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
  // An ISO string: `formatWeekdayDay` reads only strings, and a Date left
  // the Android pill (and its label) blank.
  const day = formatWeekdayDay(value.toISOString(), now) ?? "";
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
  const rowText = {
    ...typeRole(tokens.typography.role.body),
    color: tokens.color.text.foreground,
  };
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
    fieldMultiline: {
      ...fieldStyles.fieldMultilineText,
      minHeight: 88,
    },
    fieldFocused: fieldStyles.fieldFocused,
    fieldError: {
      borderColor: tokens.color.semantic.destructive,
    },
    // Starts and Ends as one grouped field, the way Calendar sets them; the
    // options under "More options" are rows of the same kind of group.
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
    whenLabel: rowText,
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
    pillText: rowText,
    more: {
      gap: tokens.spacing.sm,
    },
    optionRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
      minHeight: tokens.touch.minimum + tokens.spacing.xs,
    },
    optionLabel: rowText,
    optionValue: {
      flex: 1,
      textAlign: "right",
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
    },
    // The value sits right, the way Settings sets a number in a row, in a
    // chip that shows it is editable. Single-line, so no line height: iOS
    // sits a field's text low inside a taller line box (`fieldTypeRole`).
    pointsInput: {
      marginLeft: "auto",
      minWidth: 64,
      minHeight: 34,
      paddingHorizontal: tokens.spacing.sm,
      paddingVertical: 0,
      borderRadius: tokens.radius.chip,
      borderWidth: 1,
      borderColor: "transparent",
      backgroundColor: tokens.color.surface.popover,
      textAlign: "center",
      ...fieldTypeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    sectionLabel: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.mutedForeground,
      marginTop: tokens.spacing.xs,
    },
    caption: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
    },
    error: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructive,
    },
    deleteRow: {
      alignSelf: "center",
      minHeight: tokens.touch.minimum,
      justifyContent: "center",
      paddingHorizontal: tokens.spacing.md,
    },
    deleteText: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.semantic.destructive,
    },
  });
}
