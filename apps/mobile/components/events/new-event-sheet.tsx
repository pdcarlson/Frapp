import { forwardRef, useCallback, useMemo, useRef, useState } from "react";
import {
  Alert,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { BottomSheetModal, BottomSheetTextInput } from "@gorhom/bottom-sheet";
import { SignetTokens } from "@repo/theme/signet";
import type { EventCardTrack } from "@repo/chat-core/dispatch";
import {
  EVENT_CREATE_UNCONFIRMED,
  useCreateEvent,
  useDeleteEvent,
  useEventTypes,
  usePermissionList,
  useRoles,
  useUpdateEvent,
} from "@repo/hooks";
import {
  canAll,
  EVENT_CREATE_PERMISSIONS,
  deleteOffersSeriesChoice,
  describeAttendance,
  describeCheckIn,
  EVENT_DESCRIPTION_MAX_LENGTH,
  EVENT_FORM_AGENDA_REPEAT_NOTE,
  EVENT_FORM_MEMBER_NOTE,
  EVENT_FORM_PLACEHOLDERS,
  EVENT_FORM_ROW_LABELS,
  EVENT_LOCATION_MAX_LENGTH,
  EVENT_NAME_MAX_LENGTH,
  EVENT_NOTES_MAX_LENGTH,
  eventLimitsAudience,
  isEmptyEventPatch,
  leavesAfterSave,
  parseCheckInOpens,
  repeatEditAnchor,
  repeatEditDraft,
  repeatEditSeriesOf,
  repeatSummary,
  saveRequestFor,
  saveScopeFor,
  SERIES_SCOPE_COPY,
  type EventEditScope,
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
  SheetScrim,
  sheetFieldStyles,
  useSheetBackgroundStyle,
  useSheetClose,
  useGuardedSheetRef,
  SHEET_STACK_BEHAVIOR,
} from "@/components/sheet-scaffold";
import {
  EventTypeSheet,
  PropertyRow,
  RowDivider,
} from "@/components/events/event-form-rows";
import { AttendanceSheet } from "@/components/events/attendance-sheet";
import { WhenTimes } from "@/components/events/when-times";
import { AgendaDraftList } from "@/components/events/event-agenda";
import { RepeatOptions } from "@/components/repeat-options";
import { toRoleOptions } from "@repo/hooks/chapter-roles";
import {
  applyEventType,
  emptyEventDraft,
  resolveEventTimes,
  shiftEnd,
  validateNewEvent,
  type NewEventDraft,
  type NewEventErrors,
} from "@/lib/events/create-event";
import {
  DELETE_EVENT_PERMISSIONS,
  EDIT_EVENT_PERMISSIONS,
  draftFromEvent,
  validateEventEdit,
  type EventEditTarget,
} from "@/lib/events/edit-event";
import { gateRefusalOf } from "@/lib/chat/gated-upload";
import { successHaptic } from "@/lib/haptics";
import {
  keepEditsOver,
  useKeptSheetDraft,
  useKeptSheetOpening,
} from "@/lib/kept-sheet-draft";
import { MODULE_REFUSAL_COPY } from "@/lib/module-refusal";
import { useNotesLabel } from "@/lib/minutes/meetings-on";
import { SUBSCRIPTION_REFUSAL_COPY } from "@/lib/subscription-refusal";
import { BottomSheetScrollView } from "@/lib/sheet-scrollables";
import { askSeriesScope } from "@/lib/series-scope";

/**
 * The "New event" bottom sheet: an officer's quick create on the phone.
 *
 * Self-contained, so any screen can mount it and `present()` it: the Events
 * tab does today, through its floating create button, and a global create
 * menu can later. The host gates it with {@link useCanCreateEvents}.
 *
 * ## What it asks
 *
 * The name as a borderless title, then one property row per setting, in the
 * order and words web's form draws (#5561, `event-form-rows.tsx`): Type (its
 * own stacked sheet), When, Repeat, Location, Who's coming (by role, in its
 * own stacked sheet, `attendance-sheet.tsx`), Points, Description, Notes and
 * Check-in. Every row says what it holds at rest; When, Repeat and Check-in
 * unfold in place. Create sits small in the header. The check-in zone stays
 * on the web editor. `lib/events/create-event.ts` holds the rules.
 * Attendance starts optional for everyone, as `/event` creates it: a required
 * event marks everyone who misses it absent, so it is a choice, not a default.
 *
 * ## The platform's own pickers
 *
 * Starts and Ends unfold under the When row, laid out the way Calendar's are: a day and a time,
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

export interface EventCreatedOutcome {
  /** The new event's id, when the server's answer carried one. */
  id: string | null;
  name: string;
  /** From chat: the event keeps someone out, so no card was asked for. */
  cardKeptOut: boolean;
  /** From chat: the event exists but its card didn't post (`card_posted: false`). */
  cardLost: boolean;
}

export interface NewEventSheetProps {
  /** The host's clock, so a sheet left up overnight reads the new day. */
  now?: Date;
  /**
   * Fired after a successful create. From chat, it also says whether the
   * card stayed out (an event that keeps anyone out can't be broadcast) or
   * didn't post, so the host can say where the card went.
   */
  onCreated?: (outcome: EventCreatedOutcome) => void;
  /**
   * Set when the sheet was opened from a chat's + (#3865): the create asks
   * the server to post the event's card in `channelId`, with `trackCard`'s
   * placeholder in the thread until it lands (chat-core's `trackEventCard`,
   * as web's event form does from chat).
   */
  chat?: {
    channelId: string;
    trackCard: (name: string) => EventCardTrack;
  };
  /** Set to edit this event instead of creating one. */
  editing?: EventEditTarget;
  /**
   * What a new event's form opens filled in with: last year's event, moved
   * to this year (#3930, `lib/events/last-year-template.ts`). Still a plain
   * create, and every field is the officer's to change. Mount one sheet per
   * template (`key`), since the draft starts from it once.
   */
  template?: NewEventDraft;
  /**
   * Fired after an edit saves. `leave` says the event on screen may have been
   * replaced by the save, so the host should go back to the list.
   */
  onSaved?: (result: { leave: boolean }) => void;
  /** Fired after the event is deleted from the sheet. */
  onDeleted?: () => void;
  /**
   * Fired when the sheet has closed, however it closed: a host that mounts
   * it for one edit (an event row's long-press Edit, #5492) unmounts it then.
   */
  onClosed?: () => void;
  /**
   * Keeps an edit's draft past its host, under this name (`event-edit:<id>`,
   * #4872): event details goes when the member goes back, and Edit on the
   * same event opens on what was typed. Only what the officer changed is
   * kept: the rest comes from the event as it is when the sheet opens again.
   */
  keptDraft?: string;
}

/** What a kept edit holds: the form, and the event as it opened. */
type KeptEventEdit = NewEventDraft & { base: NewEventDraft };

/** The fields a kept edit is laid over the event by. */
const EVENT_EDIT_KEYS = [
  "eventTypeId",
  "name",
  "start",
  "end",
  "location",
  "pointsInput",
  "checkInOpensInput",
  "attendance",
  "repeat",
  "description",
  "notes",
] as const satisfies readonly (keyof NewEventDraft)[];

/** A kept edit over the event as it is now: only what the officer changed. */
function keptEventEditOver(
  kept: KeptEventEdit,
  now: NewEventDraft,
): NewEventDraft {
  const { base, ...fields } = kept;
  return {
    ...keepEditsOver<NewEventDraft>(fields, base, now, EVENT_EDIT_KEYS, [
      ["start", "end"],
    ]),
    typeFilledName: fields.typeFilledName,
    openRow: fields.openRow,
  };
}

/** Whether the viewer may create events. */
export function useCanCreateEvents(): boolean {
  // `canAll`, not `includes`: an owner's grant is the wildcard `*`.
  // `EVENT_CREATE_PERMISSIONS`: the route's `events:create` and the
  // controller's class-level `members:view`, which the API requires together.
  return canAll(EVENT_CREATE_PERMISSIONS, usePermissionList());
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

/** Calendar's question for a repeating event, in the event editors' words. */
function askEventSeriesScope(copy: {
  title: string;
  message: string;
  seriesDestructive?: boolean;
}): Promise<EventEditScope | null> {
  return askSeriesScope({
    ...copy,
    thisOne: SERIES_SCOPE_COPY.thisEvent,
    allUpcoming: SERIES_SCOPE_COPY.allUpcoming,
  });
}

/**
 * Delete's question, for the Edit sheet's Delete event and an event row's
 * long-press Delete (#5492): a repeating event not yet started asks this one
 * or all upcoming, anything else asks once. Resolves the scope to send, or
 * `null` on Cancel.
 */
export function askEventDelete(
  event: Parameters<typeof deleteOffersSeriesChoice>[0],
): Promise<EventEditScope | null> {
  if (deleteOffersSeriesChoice(event, new Date())) {
    return askEventSeriesScope({
      title: SERIES_SCOPE_COPY.deleteTitle,
      message: SERIES_SCOPE_COPY.deleteMessage,
      seriesDestructive: true,
    });
  }
  return new Promise<EventEditScope | null>((resolve) => {
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

const GATE_COPY = {
  subscription: SUBSCRIPTION_REFUSAL_COPY.event,
  module: MODULE_REFUSAL_COPY.event,
};

export const NewEventSheet = forwardRef<BottomSheetModal, NewEventSheetProps>(
  function NewEventSheet(
    {
      now,
      onCreated,
      chat,
      editing,
      template,
      onSaved,
      onDeleted,
      onClosed,
      keptDraft,
    },
    ref,
  ) {
    const { tokens } = useFrappTheme();
    const brand = useChapterBranding();
    const styles = createStyles(tokens, brand);
    const backgroundStyle = useSheetBackgroundStyle();
    const closeSheet = useSheetClose(ref);
    // Its hosts (the composer among them) dismiss it on a blur or a channel
    // switch, up or not (#5059): the ref they hold only reaches a sheet that
    // is up.
    const { modalRef, onAnimate, markClosed, dismiss, visit, isSameVisit } =
      useGuardedSheetRef(ref);
    const createEvent = useCreateEvent();
    const updateEvent = useUpdateEvent();
    const deleteEvent = useDeleteEvent();
    const grants = useEventEditGrants();
    // Making anyone required and attaching points take `events:update`
    // (#3709), which is also what editing takes: a member who may only
    // create events makes optional events worth no points.
    const setsRequirements = grants.edit;
    const attendanceRef = useRef<BottomSheetModal>(null);
    const rolesQuery = useRoles();
    // The chapter's event types (#3730), in the Type row's sheet. Managing
    // them is on web; here they only fill the form.
    const typesQuery = useEventTypes();
    const eventTypes = useMemo(() => typesQuery.data ?? [], [typesQuery.data]);
    const typeRef = useRef<BottomSheetModal>(null);
    const roleName = useMemo(() => {
      const byId = new Map(
        toRoleOptions(rolesQuery.data, "hide").map((role) => [
          role.id,
          role.name,
        ]),
      );
      return (id: string) => byId.get(id);
    }, [rolesQuery.data]);

    const at = useMemo(() => now ?? new Date(), [now]);
    const freshDraft = useCallback(
      () =>
        editing ? draftFromEvent(editing) : (template ?? emptyEventDraft()),
      [editing, template],
    );
    // An edit kept from the screen's last visit (`keptDraft`), laid over
    // the event as it is now; the event as it opened is what the next
    // visit's draft is measured from.
    const keptName = editing && keptDraft ? keptDraft : null;
    const opening = useKeptSheetOpening<KeptEventEdit>(keptName);
    const [base] = useState(freshDraft);
    const [draft, setDraft] = useState<NewEventDraft>(() =>
      opening ? keptEventEditOver(opening, base) : base,
    );
    const {
      clear: clearKept,
      hold: holdKept,
      release: releaseKept,
    } = useKeptSheetDraft<KeptEventEdit>(
      keptName,
      { ...draft, base },
      // The store's own signature of the whole value: `base` never changes.
      undefined,
      opening,
    );
    const [focused, setFocused] = useState<
      | "name"
      | "location"
      | "points"
      | "checkInOpens"
      | "description"
      | "notes"
      | null
    >(null);
    const notesLabel = useNotesLabel();
    // Written by Create; a field's line goes when that field is edited.
    const [errors, setErrors] = useState<NewEventErrors>({});
    const [submitFailed, setSubmitFailed] = useState(false);
    // The server's answer was lost (an empty-bodied or gateway 5xx): the
    // event may exist, and `POST /v1/events` has no dedupe, so this says
    // check first rather than "try again" (#1717).
    const [unconfirmed, setUnconfirmed] = useState(false);
    /** A gate refusal's member copy: retrying can't win, so Create goes. */
    const [refusal, setRefusal] = useState<string | null>(null);
    /**
     * The server refused this exact change (a 400): Save stays, since a
     * different change can win, and editing anything clears the line.
     */
    const [rejected, setRejected] = useState<string | null>(null);
    const sending = useRef(false);
    const [draggingAgenda, setDraggingAgenda] = useState(false);

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
      // A repeat refusal was about the old start (an end date before the
      // second meeting, say), and would hide the caption that now applies.
      update({ start: next, end: shiftEnd({ start, end }, next) }, [
        "start",
        "end",
        "repeat",
      ]);
    }
    function setEnd(next: Date) {
      update({ start, end: next }, ["end"]);
    }

    /** Gives the draft up: Cancel, or a save with nothing to send. */
    const reset = useCallback(() => {
      clearKept();
      setDraft(freshDraft());
      setFocused(null);
      setErrors({});
      setSubmitFailed(false);
      setUnconfirmed(false);
      setRefusal(null);
      setRejected(null);
    }, [freshDraft, clearKept]);

    /** A swipe or scrim close: the draft stays, the visit's state goes. */
    const closed = useCallback(() => {
      markClosed();
      setFocused(null);
      setSubmitFailed(false);
      setUnconfirmed(false);
      setRefusal(null);
      setRejected(null);
      onClosed?.();
    }, [markClosed, onClosed]);

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
        // Every row shows at rest, so each error sits under its own row;
        // Repeat's and Check-in's fields fold into their rows, so they open.
        const openRow = result.errors.repeat
          ? "repeat"
          : result.errors.checkInOpens
            ? "checkIn"
            : null;
        if (openRow) setDraft((previous) => ({ ...previous, openRow }));
        return;
      }
      setErrors({});
      // Nothing changed: there is nothing to send, and nobody to notify.
      if (isEmptyEventPatch(result.patch)) {
        reset();
        dismiss();
        return;
      }
      Keyboard.dismiss();
      let scope = saveScopeFor(target, result.patch, new Date());
      // Whether the officer picked the series: a Repeat change is always the
      // series, so a refusal of one can't point them to "this event only".
      const askedScope = scope === "ask";
      if (scope === "ask") {
        sending.current = true;
        const picked = await askEventSeriesScope({
          title: SERIES_SCOPE_COPY.saveTitle,
          message: SERIES_SCOPE_COPY.saveMessage,
        });
        sending.current = false;
        if (!picked) return;
        scope = picked;
      }
      const request = saveRequestFor(target, result.patch, scope);
      sending.current = true;
      // Out of the kept store until it lands or fails, so event details
      // reopened mid-save doesn't offer the same edit again.
      holdKept();
      setRejected(null);
      setSubmitFailed(false);
      setUnconfirmed(false);
      setRefusal(null);
      const sentFrom = visit();
      updateEvent.mutate(
        { id: request.id, body: { ...request.body, scope: request.scope } },
        {
          onSuccess: (saved) => {
            sending.current = false;
            successHaptic();
            clearKept();
            const savedId =
              saved && typeof saved === "object" && "id" in saved
                ? String((saved as { id: unknown }).id)
                : null;
            if (isSameVisit(sentFrom)) dismiss();
            onSaved?.({ leave: leavesAfterSave(request, target, savedId) });
          },
          onError: (error) => {
            sending.current = false;
            releaseKept();
            if (!isSameVisit(sentFrom)) return;
            const gated = gateRefusalOf(error, GATE_COPY);
            if (gated) setRefusal(gated);
            else if (isBadRequest(error)) {
              // Sending it again can't win, so say what to do instead.
              setRejected(
                askedScope && request.scope === "series"
                  ? SERIES_SCOPE_COPY.seriesRefused
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
      sending.current = true;
      const scope = await askEventDelete(target.event);
      sending.current = false;
      if (!scope) return;
      sending.current = true;
      setSubmitFailed(false);
      setUnconfirmed(false);
      setRefusal(null);
      const sentFrom = visit();
      deleteEvent.mutate(
        { id: target.event.id, scope },
        {
          onSuccess: () => {
            sending.current = false;
            successHaptic();
            // The event is gone, and its kept edit with it.
            clearKept();
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
      const result = validateNewEvent(
        { ...draft, start, end },
        new Date(),
        setsRequirements,
      );
      if (!result.ok) {
        setErrors(result.errors);
        // Every row shows at rest, so each error sits under its own row;
        // Repeat's and Check-in's fields fold into their rows, so they open.
        const openRow = result.errors.repeat
          ? "repeat"
          : result.errors.checkInOpens
            ? "checkIn"
            : null;
        if (openRow) setDraft((previous) => ({ ...previous, openRow }));
        return;
      }
      sending.current = true;
      setErrors({});
      setSubmitFailed(false);
      setUnconfirmed(false);
      setRefusal(null);
      Keyboard.dismiss();
      const sentFrom = visit();
      // From chat, the server posts the card, under the placeholder's id. An
      // event that keeps anyone out can't be broadcast, so none is asked for
      // (the API refuses one, `EventService.create`), as on web.
      const cardKeptOut = !!chat && eventLimitsAudience(result.body);
      const card =
        chat && !cardKeptOut ? chat.trackCard(result.body.name) : null;
      const handlers = {
        onSuccess: (created?: { id?: unknown; card_posted?: boolean }) => {
          sending.current = false;
          const cardLost = card !== null && created?.card_posted === false;
          if (cardLost) card.lost();
          successHaptic();
          // Saved, so the draft goes whichever visit is on screen.
          reset();
          if (isSameVisit(sentFrom)) dismiss();
          onCreated?.({
            id: typeof created?.id === "string" ? created.id : null,
            name: result.body.name,
            cardKeptOut,
            cardLost,
          });
        },
        onError: (error: unknown) => {
          sending.current = false;
          // Refused or lost, the placeholder goes: a lost answer's event may
          // exist, and the sheet's own line says to check before trying again.
          card?.failed();
          if (!isSameVisit(sentFrom)) return;
          const gated = gateRefusalOf(error, GATE_COPY);
          if (gated) setRefusal(gated);
          else if (
            error instanceof Error &&
            error.message === EVENT_CREATE_UNCONFIRMED
          ) {
            setUnconfirmed(true);
          } else setSubmitFailed(true);
        },
      };
      if (!chat) {
        createEvent.mutate(result.body, handlers);
        return;
      }
      // From chat, the outcome has to land even if the member leaves the
      // thread mid-create, which unmounts this sheet: the card's placeholder
      // settled, or the alert saying why there's no card. `mutate`'s per-call
      // callbacks don't fire after an unmount; `mutateAsync`'s promise does.
      void createEvent
        .mutateAsync(
          card
            ? {
                ...result.body,
                channel_id: chat.channelId,
                client_message_id: card.clientMessageId,
              }
            : result.body,
        )
        .then(handlers.onSuccess, handlers.onError);
    }

    // An existing series' length was set when it was made; the line comes
    // back only when the officer changes Repeat and the series is rebuilt.
    const repeatSeries = editing
      ? repeatEditSeriesOf(editing, start, at)
      : undefined;
    const repeatStart = repeatSeries ? repeatEditAnchor(repeatSeries) : start;
    const showRepeatLength = !(editing && draft.repeat.pristine);
    const repeatUnknown =
      !!editing?.event.parent_event_id && editing.parent === null;
    const repeatValue = repeatUnknown
      ? "Part of a series"
      : repeatSummary(draft.repeat, repeatStart, repeatSeries);
    const heldType =
      eventTypes.find((type) => type.id === draft.eventTypeId) ?? null;
    // Whether anything differs from how the sheet opened: Cancel then reads
    // Discard, the word web's form uses for the same drop.
    const touched =
      JSON.stringify({ ...draft, openRow: null }) !==
      JSON.stringify({ ...base, openRow: null });
    const toggleRow = (row: "repeat" | "checkIn") => {
      Keyboard.dismiss();
      setDraft((previous) => ({
        ...previous,
        openRow: previous.openRow === row ? null : row,
      }));
    };

    return (
      <>
        <BottomSheetModal
          ref={modalRef}
          stackBehavior={SHEET_STACK_BEHAVIOR}
          enableDynamicSizing
          keyboardBehavior="interactive"
          backgroundStyle={backgroundStyle}
          handleComponent={SheetGrabber}
          backdropComponent={SheetScrim}
          onAnimate={onAnimate}
          onDismiss={closed}
          // A held agenda row: the drag, not the sheet, follows the finger.
          enableContentPanningGesture={!draggingAgenda}
        >
          <SheetBackToClose onClose={closeSheet} />
          <BottomSheetScrollView
            scrollEnabled={!draggingAgenda}
            onAccessibilityEscape={closeSheet}
            contentContainerStyle={styles.body}
            keyboardShouldPersistTaps="handled"
          >
            <SheetHeader
              title={editing ? "Edit event" : "New event"}
              onCancel={cancel}
              cancelLabel={touched ? "Discard" : "Cancel"}
              cancelDisabled={pending}
              action={{
                label: editing
                  ? updateEvent.isPending
                    ? "Saving"
                    : "Save"
                  : pending
                    ? "Creating"
                    : "Create",
                accessibilityLabel: editing ? "Save changes" : "Create event",
                accessibilityHint: refusal ?? undefined,
                onPress: submit,
                disabled: !canSubmit,
                accent: brand.accent,
                onAccent: tokens.color.gold.onHouse,
              }}
            />

            {/* The name first and largest, borderless, as Calendar's and
                web's titles are (#5561). */}
            <BottomSheetTextInput
              value={draft.name}
              onChangeText={(name) => update({ name }, ["name"])}
              onFocus={() => setFocused("name")}
              onBlur={() => setFocused(null)}
              editable={!pending}
              placeholder={EVENT_FORM_PLACEHOLDERS.name}
              placeholderTextColor={tokens.color.text.muted}
              accessibilityLabel="Event name"
              maxLength={EVENT_NAME_MAX_LENGTH}
              style={[
                styles.title,
                focused === "name" ? styles.titleFocused : null,
                errors.name ? styles.fieldError : null,
              ]}
            />
            {errors.name ? (
              <Text style={styles.error}>{errors.name}</Text>
            ) : null}

            {/* One row per setting, in web's order (`EVENT_FORM_ROWS`), each
                saying what it is set to (#5561, Paul 2026-11-19: "make sure
                we keep the MOBILE AND WEB UIs in sync"). */}
            <View style={styles.group}>
              {eventTypes.length > 0 ? (
                <>
                  <PropertyRow
                    glyph="type"
                    label={EVENT_FORM_ROW_LABELS.type}
                    value={heldType?.name ?? EVENT_FORM_PLACEHOLDERS.type}
                    empty={!heldType}
                    disabled={pending}
                    accessibilityHint="Picks a type, which fills in its points and who must come."
                    onPress={() => {
                      Keyboard.dismiss();
                      typeRef.current?.present();
                    }}
                  />
                  <RowDivider />
                </>
              ) : null}

              {/* When, always open (Paul 2026-11-19): the day once, then the
                  start and end as times, as web's form sets them out. */}
              <PropertyRow glyph="when" label={EVENT_FORM_ROW_LABELS.when}>
                {null}
              </PropertyRow>
              <View style={styles.opened}>
                <WhenTimes
                  start={start}
                  end={end}
                  now={at}
                  minimumDate={startFloor}
                  disabled={pending}
                  onStart={setStart}
                  onEnd={setEnd}
                />
              </View>
              {errors.start ? (
                <Text style={styles.error}>{errors.start}</Text>
              ) : null}
              {errors.end ? (
                <Text style={styles.error}>{errors.end}</Text>
              ) : null}
              <RowDivider />

              <PropertyRow
                glyph="repeat"
                label={EVENT_FORM_ROW_LABELS.repeat}
                value={repeatValue}
                empty={!repeatUnknown && draft.repeat.preset === "NONE"}
                invalid={!!errors.repeat}
                disabled={pending || repeatUnknown}
                accessibilityHint="Shows how the event repeats."
                onPress={() => toggleRow("repeat")}
              />
              {/* A generated occurrence whose series couldn't be read
                  doesn't know its rule, so it doesn't offer to change it. */}
              {draft.openRow === "repeat" && !repeatUnknown ? (
                <View style={styles.opened}>
                  <RepeatOptions
                    draft={
                      repeatSeries
                        ? repeatEditDraft(draft.repeat, repeatSeries)
                        : draft.repeat
                    }
                    start={repeatStart}
                    onChange={(repeat) => update({ repeat }, ["repeat"])}
                    disabled={pending}
                    error={errors.repeat}
                    showCaption={showRepeatLength}
                    series={repeatSeries}
                    input={BottomSheetTextInput}
                  />
                </View>
              ) : null}
              <RowDivider />

              <PropertyRow glyph="location" label={EVENT_FORM_ROW_LABELS.location}>
                <BottomSheetTextInput
                  value={draft.location}
                  onChangeText={(location) => update({ location }, [])}
                  onFocus={() => setFocused("location")}
                  onBlur={() => setFocused(null)}
                  editable={!pending}
                  placeholder={EVENT_FORM_PLACEHOLDERS.location}
                  maxLength={EVENT_LOCATION_MAX_LENGTH}
                  placeholderTextColor={tokens.color.text.muted}
                  accessibilityLabel="Location"
                  style={styles.rowInput}
                />
              </PropertyRow>
              <RowDivider />

              <PropertyRow
                glyph="attendance"
                label={EVENT_FORM_ROW_LABELS.attendance}
                value={describeAttendance(draft.attendance, roleName)}
                invalid={!!errors.attendance}
                disabled={pending}
                accessibilityHint="Sets who must attend, by role."
                onPress={() => {
                  Keyboard.dismiss();
                  attendanceRef.current?.present();
                }}
              />
              {errors.attendance ? (
                <Text style={styles.error}>{errors.attendance}</Text>
              ) : null}

              {setsRequirements ? (
                <>
                  <RowDivider />
                  <PropertyRow glyph="points" label={EVENT_FORM_ROW_LABELS.points}>
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
                        styles.rowInput,
                        errors.points ? styles.rowInputError : null,
                      ]}
                    />
                  </PropertyRow>
                  {errors.points ? (
                    <Text style={styles.error}>{errors.points}</Text>
                  ) : null}
                </>
              ) : null}
              <RowDivider />

              {/* The agenda while the event is made (Paul 2026-11-19:
                  "where is the ability to add agenda items"). Only on
                  create: an event's agenda is edited on Event details and
                  checked off there during the meeting, so an edit here would
                  race that one. Web's form does the same. */}
              {editing ? null : (
                <>
                  <PropertyRow
                    glyph="agenda"
                    label={EVENT_FORM_ROW_LABELS.agenda}
                  >
                    {null}
                  </PropertyRow>
                  <View style={styles.opened}>
                    <AgendaDraftList
                      agenda={draft.agenda ?? []}
                      draft={draft.agendaPending ?? ""}
                      onDraftChange={(agendaPending) =>
                        update({ agendaPending }, [])
                      }
                      disabled={pending}
                      input={BottomSheetTextInput}
                      onDragging={setDraggingAgenda}
                      onChange={(agenda) => update({ agenda }, [])}
                    />
                    {draft.repeat.preset !== "NONE" &&
                    (draft.agenda?.length ?? 0) > 0 ? (
                      <Text style={styles.note}>
                        {EVENT_FORM_AGENDA_REPEAT_NOTE}
                      </Text>
                    ) : null}
                  </View>
                  <RowDivider />
                </>
              )}

              <PropertyRow
                glyph="description"
                label={EVENT_FORM_ROW_LABELS.description}
              >
                <BottomSheetTextInput
                  value={draft.description}
                  onChangeText={(description) => update({ description }, [])}
                  onFocus={() => setFocused("description")}
                  onBlur={() => setFocused(null)}
                  editable={!pending}
                  placeholder={EVENT_FORM_PLACEHOLDERS.description}
                  maxLength={EVENT_DESCRIPTION_MAX_LENGTH}
                  placeholderTextColor={tokens.color.text.muted}
                  accessibilityLabel="Description"
                  multiline
                  style={[styles.rowInput, styles.rowInputMultiline]}
                />
              </PropertyRow>
              <RowDivider />

              {/* Notes (#4934): every member the event invites reads them on
                  Event details, named as that screen names them. */}
              <PropertyRow glyph="notes" label={notesLabel}>
                <BottomSheetTextInput
                  value={draft.notes ?? ""}
                  onChangeText={(notes) => update({ notes }, [])}
                  onFocus={() => setFocused("notes")}
                  onBlur={() => setFocused(null)}
                  editable={!pending}
                  placeholder={EVENT_FORM_PLACEHOLDERS.notes}
                  maxLength={EVENT_NOTES_MAX_LENGTH}
                  placeholderTextColor={tokens.color.text.muted}
                  accessibilityLabel={notesLabel}
                  multiline
                  style={[styles.rowInput, styles.rowInputMultiline]}
                />
              </PropertyRow>
              <RowDivider />

              {/* #3703: members arrive early, so check-in opens ahead of the
                  start; 10 minutes unless the officer says. The check-in zone
                  is drawn on web, where a map belongs. */}
              <PropertyRow
                glyph="checkIn"
                label={EVENT_FORM_ROW_LABELS.checkIn}
                value={describeCheckIn(
                  parseCheckInOpens(draft.checkInOpensInput),
                )}
                invalid={
                  !!errors.checkInOpens ||
                  parseCheckInOpens(draft.checkInOpensInput) === null
                }
                disabled={pending}
                accessibilityHint="Shows how many minutes early check-in opens."
                onPress={() => toggleRow("checkIn")}
              />
              {draft.openRow === "checkIn" ? (
                <View style={[styles.opened, styles.checkInValue]}>
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
                      styles.minutesInput,
                      errors.checkInOpens ? styles.rowInputError : null,
                    ]}
                  />
                  <Text style={styles.rowSuffix}>minutes early</Text>
                </View>
              ) : null}
              {errors.checkInOpens ? (
                <Text style={styles.error}>{errors.checkInOpens}</Text>
              ) : null}
            </View>

            {setsRequirements ? null : (
              <Text style={styles.note}>{EVENT_FORM_MEMBER_NOTE}</Text>
            )}

            {refusal ? <Text style={styles.error}>{refusal}</Text> : null}
            {rejected ? <Text style={styles.error}>{rejected}</Text> : null}
            {unconfirmed ? (
              <Text style={styles.error}>
                We couldn&apos;t confirm it saved. Check Events before you
                create it again: it may already be there.
              </Text>
            ) : null}
            {submitFailed ? (
              <Text style={styles.error}>
                That didn&apos;t save. Your{" "}
                {editing ? "changes are" : "event is"} still here, so try again.
              </Text>
            ) : null}


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

        <EventTypeSheet
          ref={typeRef}
          types={eventTypes}
          value={draft.eventTypeId}
          showSets={setsRequirements}
          onPick={(type) => {
            if (!type) {
              update({ eventTypeId: null }, []);
              return;
            }
            // Picking the held one again keeps it: the list's No type is
            // how it is let go.
            if (type.id === draft.eventTypeId) return;
            update(applyEventType(draft, type, setsRequirements), [
              "name",
              "points",
              "attendance",
            ]);
          }}
        />

        <AttendanceSheet
          ref={attendanceRef}
          value={draft.attendance}
          onChange={(attendance) => update({ attendance }, ["attendance"])}
          allowRequired={setsRequirements}
        />
      </>
    );
  },
);

function createStyles(tokens: SignetTokens, brand: ChapterBranding) {
  const fieldStyles = sheetFieldStyles(tokens, brand.accent);
  return StyleSheet.create({
    body: {
      paddingHorizontal: tokens.spacing.lg,
      paddingBottom: tokens.spacing.xl,
      gap: tokens.spacing.sm,
    },
    // The name: the sheet's largest text, borderless until it holds the
    // caret, as web's form draws it.
    title: {
      ...fieldTypeRole(tokens.typography.role.title),
      color: tokens.color.text.foreground,
      minHeight: tokens.touch.minimum,
      paddingHorizontal: tokens.spacing.sm,
      marginHorizontal: -tokens.spacing.sm,
      paddingVertical: 0,
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: "transparent",
    },
    titleFocused: fieldStyles.fieldFocused,
    fieldError: {
      borderColor: tokens.color.semantic.destructive,
    },
    // The rows as one grouped list, the way Calendar and Settings set them.
    group: {
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tokens.color.border.input,
      backgroundColor: tokens.color.surface.surface1,
      paddingHorizontal: tokens.spacing.md,
    },
    // A row's pickers or options, opened in place under it.
    opened: {
      paddingBottom: tokens.spacing.sm,
      gap: tokens.spacing.xs,
    },
    // A value typed in place: the row's own text, no box. Single-line, so no
    // line height: iOS sits a field's text low inside a taller line box
    // (`fieldTypeRole`).
    rowInput: {
      flex: 1,
      minHeight: tokens.touch.minimum,
      paddingVertical: 0,
      paddingHorizontal: 0,
      ...fieldTypeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    rowInputMultiline: {
      paddingVertical: tokens.spacing.sm,
    },
    rowInputError: {
      color: tokens.color.semantic.destructive,
    },
    // The minutes field, unfolded under its row and set under the label.
    checkInValue: {
      flexDirection: "row",
      paddingLeft: 18 + tokens.spacing.sm,
      alignItems: "center",
      gap: tokens.spacing.xs,
    },
    minutesInput: {
      minWidth: 36,
      minHeight: tokens.touch.minimum,
      paddingVertical: 0,
      paddingHorizontal: 0,
      ...fieldTypeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    rowSuffix: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
    },
    note: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
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
