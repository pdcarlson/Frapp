"use client";

import { Check } from "lucide-react";
import { EventsGlyph, LocationGlyph } from "../chat-glyphs";
import {
  countCheckedIn,
  useAttendance,
  useMyPermissions,
  useNow,
} from "@repo/hooks";
import { EYEBROW, MESSAGE_CARD } from "../chip";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@repo/chat-core/types";
import { readEventPayload } from "@repo/chat-core/cards";
import { can, checkInWindowBounds } from "@repo/validation";
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

  if (!payload) {
    return (
      <div className="mt-1 whitespace-pre-wrap break-words text-base">
        {message.content}
      </div>
    );
  }

  const checkedIn = countCheckedIn(attendance);
  const start = parseInstant(payload.start_time);
  const end = parseInstant(payload.end_time);
  // The server's window (`spec/behavior/events.md` § Check-In): the event's
  // lead before the start to the grace after the end.
  const bounds =
    start && end
      ? checkInWindowBounds(start, end, payload.check_in_opens_minutes)
      : null;
  const windowOpen =
    !!bounds &&
    now >= bounds.opensAt.getTime() &&
    now <= bounds.closesAt.getTime();
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
        {payload.is_mandatory ? (
          // A status, so the danger badge, never the accent (components.md §5),
          // as the Events list and detail sheet draw it.
          <Badge variant="destructive">Mandatory</Badge>
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
      {windowOpen ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            size="sm"
            {...gate.controlProps(actionsDisabled)}
            onClick={() => void checkIn.run(payload.event_id, payload.point_value)}
          >
            <Check className="h-4 w-4" />
            Check in
          </Button>
          {/*
            Scoped to the open check-in window, like the button it explains — a
            timeline of past events would otherwise repeat one chapter-wide
            sentence under every event card.
          */}
          <SubscriptionNotice
            gate={gate}
            feature="event check-in"
            className="mb-0 w-full"
          />
        </div>
      ) : null}
    </Card>
  );
}
