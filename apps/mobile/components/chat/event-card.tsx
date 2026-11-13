import { useRef, useState } from "react";
import { useRouter } from "expo-router";
import type { EventPayload } from "@repo/chat-core/cards";
import {
  countCheckedIn,
  eventCardRequiresViewer,
  useAttendance,
  useCheckIn,
  useCurrentChapter,
  useEvent,
  useEventCardExcuse,
  useMyAttendance,
  useNowDate,
  usePermissionList,
  useRequiredOfViewer,
} from "@repo/hooks";
import { can, isModuleEnabled, statusLabel } from "@repo/validation";
import { CheckGlyph } from "@/components/tasks/task-glyphs";
import { EventsGlyph } from "@/components/tab-glyphs";
import { HairlineChip } from "@/components/status-chip";
import { useConnection } from "@/lib/connection/use-connection";
import {
  CHECK_IN_LOCATION_DENIED_COPY,
  checkInFailure,
  checkInSuccess,
  needsScannedCode,
  type CheckInOutcome,
} from "@/lib/events/check-in-outcome";
import { formatEventWindow, resolveCheckInWindow } from "@/lib/events/format";
import { selectEventDetail, selectMyAttendance } from "@/lib/events/select";
import { latLngOf, requireForegroundFix } from "@/lib/location";
import { MODULE_REFUSAL_COPY } from "@/lib/module-refusal";
import { useFrappTheme } from "@/lib/theme";
import {
  CardActions,
  CardButton,
  CardEyebrow,
  CardMeta,
  CardMetaWithGlyph,
  CardNote,
  CardTitle,
  ChatCardShell,
  PointsChip,
  type ChatCardFrameProps,
} from "./chat-card";
import { LocationGlyph } from "./location-glyph";

/**
 * The chat event card on mobile (#3185), web's
 * `apps/web/components/chat/renderers/event-card.tsx` on the phone.
 *
 * The message is an immutable creation-time snapshot (name, when, where, the
 * points), read by `readEventPayload` from `@repo/chat-core/cards`, the reader
 * web uses. Server-originated: a client cannot forge `kind:"event"`.
 *
 * **Check in, inline.** Inside the event's window (its lead before the start,
 * to the end plus the 15-minute grace, `resolveCheckInWindow`), any member can check in from the
 * card. It is the plain self check-in web's card makes, with one thing web
 * can't do: an event with a check-in zone needs the member's position, so the
 * card reads the event while the window is open to learn whether it has one,
 * and asks for location only then, through `lib/location.ts` as s18 does. The
 * server enforces the window, the zone and one-per-member either way.
 *
 * Mobile has no toast, so the outcome is a line on the card, in s18's words
 * (`lib/events/check-in-outcome.ts`). A 409 is the member already on the list,
 * which is a success. Check-in has no outbox, so the button is disabled while
 * a write would be lost (`useConnection().writeBlockedReason`).
 *
 * **Already on the list.** While the window is open the card reads the
 * member's own row (`useMyAttendance`), as Event details does (#3703), so a
 * member who scanned in at the door, or checked in from this card before it
 * scrolled away and remounted, sees "Checked in", not a Check in button the
 * server would only refuse. An officer's mark (excused, absent) shows as that
 * mark, with no button, since the server won't let a check-in replace it.
 * Once the row has loaded it decides; the tap's own outcome only fills in
 * while it hasn't (a 409 also answers an officer's mark, so "already" must not
 * outrank the row that says which).
 *
 * **The checked-in count** is the attendance roster, which only an
 * `events:update` holder can read, so nobody else asks for it or sees a count.
 *
 * **Can't make it** (#4660). A member the event requires, by the card's own
 * role fields (`useEventCardExcuse`), gets a secondary Can't make it beside
 * Check in that opens Event details with the excuse line already open, the
 * way a calendar invite in Gmail or Slack carries its RSVP on the message.
 * Once they've sent one, the card says where it stands ("Excuse sent to
 * Jake", "Excused") instead. Nobody else sees either, and only those cards
 * read anything for it.
 */
export function EventCard({
  payload,
  onNavigate,
  ...frame
}: ChatCardFrameProps & {
  payload: EventPayload;
  /**
   * Runs before the card leaves for another screen: the Activity sheet passes
   * its close, since a pushed screen opens underneath the sheet.
   */
  onNavigate?: () => void;
}) {
  const { tokens } = useFrappTheme();
  const now = useNowDate();
  const open =
    resolveCheckInWindow(
      payload.start_time,
      payload.end_time,
      now,
      payload.check_in_opens_minutes,
    ).state === "open";

  const permissions = usePermissionList();
  const canViewAttendance = can("events:update", permissions);
  const attendance = useAttendance(canViewAttendance ? payload.event_id : "");
  const checkedIn = countCheckedIn(attendance.data);

  // Only while check-in is open: that is the one moment the zone matters.
  const eventQuery = useEvent(open ? payload.event_id : "");
  const detail = selectEventDetail(eventQuery.data);
  const needsLocation = detail?.hasCheckInZone ?? false;
  // Until the read answers, the card can't tell whether to send a position,
  // and sending none to a zoned event is a guaranteed refusal. A failed read
  // stops waiting: the server's answer then explains itself.
  const zoneUnknown =
    open && eventQuery.data === undefined && !eventQuery.isError;

  // The member view the module gate reads, as the poll card's does. Hidden
  // only once the read says Events is off; the server refuses either way.
  const chapterQuery = useCurrentChapter();
  const eventsOff =
    chapterQuery.data !== undefined &&
    !isModuleEnabled(chapterQuery.data?.enabled_modules, "events");

  // The member's own row, while it can change what the card offers. This
  // client's own check-ins and an officer's status writes invalidate
  // `["attendance", eventId]`, which this key sits under; a check-in from
  // another device shows once the row is re-read (a remount, or the app
  // returning to the foreground), and a tap before then gets the server's 409.
  const mine = useMyAttendance(open ? payload.event_id : "");
  const excuse = useEventCardExcuse(payload, now);
  // Mandatory means required of this viewer, as the Events list says it
  // (#4132): by default or by a role of theirs, else the card's own answer.
  const required = eventCardRequiresViewer(payload, useRequiredOfViewer());
  const own = selectMyAttendance(mine.data);
  // A row without a check-in is an officer's mark.
  const marked = own && !own.checkedInAt ? own.status : null;

  const { writeBlockedReason } = useConnection();
  const checkIn = useCheckIn();
  const [outcome, setOutcome] = useState<CheckInOutcome | null>(null);
  // Once an officer's screen has shown the code, the server wants it (#4532):
  // the card's Check in turns into Scan code, which opens s18 on this event.
  const [scanInstead, setScanInstead] = useState(false);
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  // Two taps in one frame both see `submitting` false; the ref doesn't.
  const inFlight = useRef(false);

  const submit = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setOutcome(null);
    try {
      // A failed read left the zone unknown, so ask once more on the tap:
      // sending no position to a zoned event gets a refusal written for web's
      // card ("use the Frapp mobile app"), which reads wrong here.
      const zoned = eventQuery.isError
        ? (selectEventDetail((await eventQuery.refetch()).data)
            ?.hasCheckInZone ?? false)
        : needsLocation;
      // Coordinates only: the drawn zone is a polygon and reads no accuracy,
      // and an API from before #4532 refuses an `accuracy_meters` it doesn't
      // declare.
      const position = zoned
        ? latLngOf(await requireForegroundFix(CHECK_IN_LOCATION_DENIED_COPY))
        : {};
      await checkIn.mutateAsync({ eventId: payload.event_id, ...position });
      setOutcome(checkInSuccess(payload.point_value));
    } catch (error) {
      setOutcome(checkInFailure(error));
      setScanInstead(needsScannedCode(error));
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  // The row wins once it has loaded: `mine.data` is the server's answer, and
  // `own` is null in it only when the member has no row at all.
  const rowKnown = mine.data !== undefined;
  const checkedInNow = rowKnown
    ? own?.checkedInAt != null ||
      // A row-less answer read before this tap's write landed; the write
      // re-reads the row, which then takes over (an officer's mark included).
      (own === null &&
        (outcome?.kind === "success" || outcome?.kind === "already"))
    : outcome?.kind === "success" || outcome?.kind === "already";
  // A failure from an earlier tap says nothing once the member is checked in.
  const shownOutcome =
    outcome &&
    (!checkedInNow || outcome.kind === "success" || outcome.kind === "already")
      ? outcome
      : null;
  const blockedReason =
    writeBlockedReason ??
    (outcome?.kind === "blocked" ? outcome.message : null);
  const disabled =
    !frame.isConfirmed || submitting || zoneUnknown || blockedReason !== null;

  const openExcuse = () => {
    onNavigate?.();
    router.push({
      pathname: "/event-details",
      params: { id: payload.event_id, excuse: "1" },
    });
  };
  const excuseButton =
    excuse.kind === "offer" && !eventsOff ? (
      <CardButton
        label="Can't make it"
        onPress={openExcuse}
        disabled={!frame.isConfirmed}
        accessibilityHint="Opens the event to send an excuse."
      />
    ) : null;
  const showCheckIn = open && !eventsOff && !(marked && !checkedInNow);

  return (
    <ChatCardShell
      {...frame}
      header={
        <>
          <CardEyebrow
            label="Event"
            glyph={EventsGlyph}
            trailing={required ? <HairlineChip label="Mandatory" /> : null}
          />
          <CardTitle>{payload.name}</CardTitle>
          <CardMeta
            items={[
              formatEventWindow(payload.start_time, payload.end_time, now),
            ]}
          />
          <CardMeta
            items={[
              payload.location ? (
                <CardMetaWithGlyph
                  glyph={
                    <LocationGlyph color={tokens.color.text.mutedForeground} />
                  }
                  text={payload.location}
                />
              ) : null,
            ]}
          />
          <CardMeta
            items={[
              payload.point_value ? (
                <PointsChip points={payload.point_value} />
              ) : null,
              canViewAttendance && checkedIn !== null
                ? `${checkedIn} checked in`
                : null,
            ]}
          />
        </>
      }
    >
      {open && eventsOff ? (
        <CardNote text={MODULE_REFUSAL_COPY.checkIn} />
      ) : null}
      {open && !eventsOff && marked && !checkedInNow ? (
        <CardNote
          text={`Marked ${statusLabel("attendance", marked).toLowerCase()}`}
        />
      ) : null}
      {showCheckIn ? (
        <>
          <CardActions>
            {checkedInNow ? (
              // An indicator, not an action: the member is on the list.
              <CardButton
                label="Checked in"
                onPress={() => undefined}
                disabled
                icon={(color) => <CheckGlyph color={color} />}
              />
            ) : scanInstead ? (
              <CardButton
                label="Scan code"
                variant="primary"
                onPress={() => {
                  onNavigate?.();
                  router.push({
                    pathname: "/check-in",
                    params: { eventId: payload.event_id },
                  });
                }}
                disabled={blockedReason !== null}
              />
            ) : (
              <CardButton
                label={submitting ? "Checking in…" : "Check in"}
                variant="primary"
                onPress={() => void submit()}
                disabled={disabled}
                accessibilityHint={blockedReason ?? undefined}
              />
            )}
            {excuseButton}
          </CardActions>
          {shownOutcome ? (
            <CardNote
              text={shownOutcome.message}
              tone={
                checkedInNow
                  ? "success"
                  : shownOutcome.kind === "error"
                    ? "error"
                    : "muted"
              }
            />
          ) : needsLocation && !checkedInNow ? (
            <CardNote text="This event checks you in by location." />
          ) : null}
        </>
      ) : null}
      {!showCheckIn && excuseButton ? (
        <CardActions>{excuseButton}</CardActions>
      ) : null}
      {/* An approved excuse already reads "Marked excused" above while
          check-in is open; the same fact twice would stack two notes. */}
      {excuse.kind === "sent" &&
      !(open && !eventsOff && marked === "EXCUSED") ? (
        <CardNote text={excuse.title} />
      ) : null}
    </ChatCardShell>
  );
}
