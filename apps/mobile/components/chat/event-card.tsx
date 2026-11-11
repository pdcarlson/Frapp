import { useRef, useState } from "react";
import type { EventPayload } from "@repo/chat-core/cards";
import {
  countCheckedIn,
  useAttendance,
  useCheckIn,
  useCurrentChapter,
  useEvent,
  useNowDate,
  usePermissionList,
} from "@repo/hooks";
import { can, isModuleEnabled } from "@repo/validation";
import { CheckGlyph } from "@/components/tasks/task-glyphs";
import { EventsGlyph } from "@/components/tab-glyphs";
import { StatusChip } from "@/components/status-chip";
import { useConnection } from "@/lib/connection/use-connection";
import {
  CHECK_IN_LOCATION_DENIED_COPY,
  checkInFailure,
  checkInSuccess,
  type CheckInOutcome,
} from "@/lib/events/check-in-outcome";
import { formatEventWindow, resolveCheckInWindow } from "@/lib/events/format";
import { selectEventDetail } from "@/lib/events/select";
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
 * **The checked-in count** is the attendance roster, which only an
 * `events:update` holder can read, so nobody else asks for it or sees a count.
 */
export function EventCard({
  payload,
  ...frame
}: ChatCardFrameProps & { payload: EventPayload }) {
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
  const zoneUnknown = open && eventQuery.data === undefined && !eventQuery.isError;

  // The member view the module gate reads, as the poll card's does. Hidden
  // only once the read says Events is off; the server refuses either way.
  const chapterQuery = useCurrentChapter();
  const eventsOff =
    chapterQuery.data !== undefined &&
    !isModuleEnabled(chapterQuery.data?.enabled_modules, "events");

  const { writeBlockedReason } = useConnection();
  const checkIn = useCheckIn();
  const [outcome, setOutcome] = useState<CheckInOutcome | null>(null);
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
      // The check-in DTO takes lat/lng only; spreading accuracy would 400.
      const position = zoned
        ? latLngOf(await requireForegroundFix(CHECK_IN_LOCATION_DENIED_COPY))
        : {};
      await checkIn.mutateAsync({ eventId: payload.event_id, ...position });
      setOutcome(checkInSuccess(payload.point_value));
    } catch (error) {
      setOutcome(checkInFailure(error));
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  const checkedInNow = outcome?.kind === "success" || outcome?.kind === "already";
  const blockedReason =
    writeBlockedReason ??
    (outcome?.kind === "blocked" ? outcome.message : null);
  const disabled =
    !frame.isConfirmed || submitting || zoneUnknown || blockedReason !== null;

  return (
    <ChatCardShell
      {...frame}
      header={
        <>
          <CardEyebrow
            label="Event"
            glyph={EventsGlyph}
            trailing={
              payload.is_mandatory ? (
                <StatusChip
                  label="Mandatory"
                  hue={tokens.color.semantic.destructive}
                />
              ) : null
            }
          />
          <CardTitle>{payload.name}</CardTitle>
          <CardMeta
            items={[formatEventWindow(payload.start_time, payload.end_time, now)]}
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
      {open && eventsOff ? <CardNote text={MODULE_REFUSAL_COPY.checkIn} /> : null}
      {open && !eventsOff ? (
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
            ) : (
              <CardButton
                label={submitting ? "Checking in…" : "Check in"}
                variant="primary"
                onPress={() => void submit()}
                disabled={disabled}
                accessibilityHint={blockedReason ?? undefined}
              />
            )}
          </CardActions>
          {outcome ? (
            <CardNote
              text={outcome.message}
              tone={
                checkedInNow
                  ? "success"
                  : outcome.kind === "error"
                    ? "error"
                    : "muted"
              }
            />
          ) : needsLocation && !checkedInNow ? (
            <CardNote text="This event checks you in by location." />
          ) : null}
        </>
      ) : null}
    </ChatCardShell>
  );
}
