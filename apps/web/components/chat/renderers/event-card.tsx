"use client";

import Link from "next/link";
import { Check } from "lucide-react";
import { EventsGlyph, LocationGlyph } from "../chat-glyphs";
import {
  countCheckedIn,
  eventCardRequiresViewer,
  selectOwnAttendance,
  useAttendance,
  useCurrentChapter,
  useEvent,
  useEventCardExcuse,
  useMyAttendance,
  useMyPermissions,
  useNow,
  useRequiredOfViewer,
} from "@repo/hooks";
import { EYEBROW, MESSAGE_CARD } from "../chip";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@repo/chat-core/types";
import { readEventPayload } from "@repo/chat-core/cards";
import {
  can,
  CHECK_IN_MODULE_OFF_LINE,
  checkInWindowBounds,
  isModuleEnabled,
} from "@repo/validation";
import {
  formatEventWindow,
  formatPointsChip,
  parseInstant,
} from "@repo/formatting";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  SubscriptionNotice,
  useSubscriptionGate,
} from "@/components/shared/subscription-gate";
import { useSelfCheckIn } from "@/lib/hooks/use-self-check-in";
import { eventDeepLink } from "@/lib/events/event-links";
import {
  checkInZoneState,
  myCheckInView,
  ZONE_CHECK_IN_LINE,
} from "@/components/events/my-check-in";

interface EventCardProps {
  message: ChatMessage;
  /** False while the optimistic chat row is not yet server-acked. */
  isConfirmed: boolean;
}

/**
 * Event card. The chat message is an immutable creation-time snapshot (name,
 * when, location, point value); the *live* checked-in count is read back from
 * the attendance query so the card reflects check-ins without ever mutating the
 * message row. Server-originated (a client cannot forge `kind:"event"` — see
 * `ChatService.SERVER_ONLY_KINDS`).
 *
 * Interactive: any member can Check in during the event window — the button
 * fires the existing check-in endpoint (the server enforces the window, role
 * gate, and one-per-member uniqueness; the gating here is UX-only). The
 * request and its toasts are `useSelfCheckIn`'s, shared with the event sheet.
 *
 * While check-in is open the card reads the viewer's own row and the event,
 * as the phone's card does (#4136): Check in reads "Checking in…" while it
 * runs, then a disabled "Checked in" (or the officer's mark), and an event
 * that checks location says to check in from the app, the event sheet's
 * words (`myCheckInView`, shared with the sheet). With Events turned off for
 * the chapter it offers neither control and says why.
 *
 * Can't make it (#4660): a member the event requires, by the card's own role
 * fields (`useEventCardExcuse`), gets a secondary Can't make it that opens the
 * event's sheet with the excuse line open (`/events?event=<id>&excuse=1`), as
 * a calendar invite in Gmail or Slack carries its RSVP on the message. Once
 * they've sent one, the card says where it stands instead. Nobody else sees
 * either, and only those cards read anything for it.
 */
export function EventCard({ message, isConfirmed }: EventCardProps) {
  const payload = readEventPayload(message);
  const checkIn = useSelfCheckIn();
  // `POST /v1/events/:eventId/attendance/check-in` sits on `AttendanceController`,
  // which is `ChapterGuard`-guarded with no `@FreeTier` — so it is paid-ops even
  // though this card is rendered inside chat, which is free-tier. The host
  // surface does not decide the gate; the route does (#841).
  //
  // Above the malformed-payload early return below, like the other hooks here.
  const gate = useSubscriptionGate();

  // The checked-in count comes from the attendance roster, which is admin-gated
  // (`events:update`). Members can still self-check-in (that endpoint is
  // member-open), but they can't read the roster — so only fetch and show the
  // count for viewers who can view attendance. Otherwise the request 403s and
  // the card would show a misleading "0 checked in" to everyone else.
  const { data: permData } = useMyPermissions();
  const canViewAttendance = can("events:update", permData?.permissions ?? []);

  // Hooks must run before any early return; `useAttendance` no-ops on an empty
  // id, so a viewer without attendance access never fires the (403-ing) request.
  const eventId = payload?.event_id ?? "";
  const { data: attendance } = useAttendance(canViewAttendance ? eventId : "");
  const now = useNow();
  // One rule for the Mandatory badge and the excuse offer (#4132).
  const requiredOf = useRequiredOfViewer();
  const excuse = useEventCardExcuse(payload, new Date(now), requiredOf);
  const chapterQuery = useCurrentChapter();
  const eventsOff =
    chapterQuery.data !== undefined &&
    !isModuleEnabled(chapterQuery.data?.enabled_modules, "events");
  // Only while check-in is open, the one moment they matter, so a channel of
  // past event cards reads nothing for them.
  const start = parseInstant(payload?.start_time);
  const end = parseInstant(payload?.end_time);
  const bounds =
    payload && start && end
      ? checkInWindowBounds(start, end, payload.check_in_opens_minutes)
      : null;
  const windowOpen =
    !!bounds &&
    now >= bounds.opensAt.getTime() &&
    now <= bounds.closesAt.getTime();
  const liveId = windowOpen && !eventsOff ? eventId : "";
  const mine = useMyAttendance(liveId);
  const eventQuery = useEvent(liveId);

  if (!payload) {
    return (
      <div className="mt-1 whitespace-pre-wrap break-words text-base">
        {message.content}
      </div>
    );
  }

  const checkedIn = countCheckedIn(attendance);
  // The server's window (`spec/behavior/events.md` § Check-In), above: the
  // event's lead before the start to the grace after the end. Inside it, the
  // sheet's rule for what the viewer's own check-in says.
  const own = windowOpen
    ? myCheckInView({
        own: selectOwnAttendance(mine.data),
        justCheckedIn: checkIn.checkedInEventId === payload.event_id,
        ownLoading: mine.isPending && mine.fetchStatus !== "paused",
        start: payload.start_time,
        end: payload.end_time,
        opensMinutes: payload.check_in_opens_minutes,
        // Until the event reads, a zone is unknown; offering Check in to a
        // zoned event is a sure refusal, so the card waits. A failed read
        // stops waiting, and the server's answer explains itself.
        zone: checkInZoneState(
          // The SDK types this read loosely (the sheet casts it too).
          (eventQuery.data as { check_in_zone?: unknown } | undefined)
            ?.check_in_zone,
        ),
        now: new Date(now),
      })
    : null;
  const zoneUnknown =
    windowOpen && eventQuery.data === undefined && !eventQuery.isError;
  const offerCheckIn =
    !eventsOff && own?.kind === "open" && own.zone === "none" && !zoneUnknown;
  const zoneLine =
    !eventsOff && own?.kind === "open" && own.zone !== "none"
      ? ZONE_CHECK_IN_LINE[own.zone]
      : null;
  const checkedInDone = !eventsOff && own?.kind === "checked-in";
  const markedLine = !eventsOff && own?.kind === "marked" ? own.label : null;
  const offerExcuse = !eventsOff && excuse.kind === "offer";
  const actionsDisabled = !isConfirmed || checkIn.isPending;

  return (
    <Card className={cn(MESSAGE_CARD)}>
      <div className="flex items-center justify-between gap-2">
        <div
          className={cn(
            EYEBROW,
            "flex items-center gap-1.5 text-muted-foreground",
          )}
        >
          <EventsGlyph className="h-4 w-4" /> Event
        </div>
        {eventCardRequiresViewer(payload, requiredOf) ? (
          // Required of this viewer, in the hairline kind, as the Events list
          // and the phone draw it (#3822, #4132).
          <Badge variant="outline">Mandatory</Badge>
        ) : null}
      </div>
      <p className="mt-2 text-base font-bold">{payload.name}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-muted-foreground">
        <span>
          {formatEventWindow(
            payload.start_time,
            payload.end_time,
            new Date(now),
          ) ?? payload.start_time}
        </span>
        {payload.location ? (
          <>
            <span aria-hidden="true">·</span>
            <span className="inline-flex items-center gap-1">
              <LocationGlyph className="h-4 w-4" />
              {payload.location}
            </span>
          </>
        ) : null}
        {payload.point_value ? (
          <Badge variant="outline">
            {formatPointsChip(payload.point_value)}
          </Badge>
        ) : null}
      </div>
      {canViewAttendance && checkedIn !== null ? (
        <p className="mt-2 text-caption text-muted-foreground">
          {checkedIn} checked in
        </p>
      ) : null}
      {offerCheckIn || checkedInDone || offerExcuse ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {offerCheckIn ? (
            <Button
              size="sm"
              {...gate.controlProps(actionsDisabled)}
              onClick={() =>
                void checkIn.run(payload.event_id, payload.point_value)
              }
            >
              <Check className="h-4 w-4" aria-hidden="true" />
              {checkIn.isPending ? "Checking in…" : "Check in"}
            </Button>
          ) : null}
          {checkedInDone ? (
            // Done, not gone: the place the member just pressed keeps saying
            // so, as the phone's card does.
            <Button size="sm" variant="secondary" disabled>
              <Check className="h-4 w-4" aria-hidden="true" />
              Checked in
            </Button>
          ) : null}
          {offerExcuse ? (
            <Button asChild size="sm" variant="secondary">
              <Link href={eventDeepLink(payload.event_id, { excuse: true })}>
                Can&apos;t make it
              </Link>
            </Button>
          ) : null}
          {/*
            Scoped to the open check-in window, like the button it explains — a
            timeline of past events would otherwise repeat one chapter-wide
            sentence under every event card.
          */}
          {offerCheckIn ? (
            <SubscriptionNotice
              gate={gate}
              feature="event check-in"
              className="mb-0 w-full"
            />
          ) : null}
        </div>
      ) : null}
      {(markedLine ?? zoneLine) ? (
        <p className="mt-2 text-caption text-muted-foreground">
          {markedLine ?? zoneLine}
        </p>
      ) : null}
      {eventsOff && (windowOpen || excuse.kind === "offer") ? (
        <p className="mt-2 text-caption text-muted-foreground">
          {CHECK_IN_MODULE_OFF_LINE}
        </p>
      ) : null}
      {excuse.kind === "sent" ? (
        <p className="mt-2 text-caption text-muted-foreground">
          {excuse.title}
        </p>
      ) : null}
    </Card>
  );
}
