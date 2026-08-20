"use client";

import { CalendarDays, Check, MapPin } from "lucide-react";
import { useAttendance, useCheckIn, useMyPermissions } from "@repo/hooks";
import type { ChatMessage } from "@repo/chat-core/types";
import type { EventPayload } from "@repo/chat-integrations";
import { can } from "@repo/validation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  SubscriptionNotice,
  useSubscriptionGate,
} from "@/components/shared/subscription-gate";
import { useToast } from "@/hooks/use-toast";
import { getErrorMessage } from "@/lib/utils";
import { useNow } from "@/lib/use-now";

interface EventCardProps {
  message: ChatMessage;
  /** False while the optimistic chat row is not yet server-acked. */
  isConfirmed: boolean;
}

/** Grace window (ms) after end_time during which check-in stays open (spec: 15 min). */
const CHECK_IN_GRACE_MS = 15 * 60 * 1000;

/**
 * Defensive read of an `event` payload. A malformed row returns `null` so the
 * renderer falls back to the hot-path `content` string instead of blanking the
 * timeline (master-plan guard-on-missing-key rule).
 */
function readPayload(message: ChatMessage): EventPayload | null {
  const raw = message.payload;
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (
    typeof r.event_id !== "string" ||
    typeof r.name !== "string" ||
    typeof r.start_time !== "string" ||
    typeof r.end_time !== "string"
  ) {
    return null;
  }
  return {
    event_id: r.event_id,
    name: r.name,
    start_time: r.start_time,
    end_time: r.end_time,
    location: typeof r.location === "string" ? r.location : null,
    point_value:
      typeof r.point_value === "number" && Number.isFinite(r.point_value)
        ? r.point_value
        : 0,
    is_mandatory: r.is_mandatory === true,
    created_at: typeof r.created_at === "string" ? r.created_at : "",
  };
}

/**
 * Count attendance rows that represent a present member (PRESENT or LATE).
 * Guards a non-array result to `0` so an empty/loading query renders cleanly
 * (integrations.md first-match/empty-state rule).
 */
function countCheckedIn(data: unknown): number {
  if (!Array.isArray(data)) return 0;
  return data.reduce((acc: number, row) => {
    if (!row || typeof row !== "object") return acc;
    const status = (row as Record<string, unknown>).status;
    return status === "PRESENT" || status === "LATE" ? acc + 1 : acc;
  }, 0);
}

function formatRange(startIso: string, endIso: string): string {
  const start = new Date(startIso);
  if (Number.isNaN(start.getTime())) return startIso;
  const date = start.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  const startTime = start.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  const end = new Date(endIso);
  if (Number.isNaN(end.getTime())) return `${date}, ${startTime}`;
  const endTime = end.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${date}, ${startTime}–${endTime}`;
}

/**
 * A check-in conflict (already on the attendance list) surfaces as HTTP 409.
 * Prefer the typed status off the error body over string-matching the message,
 * which is brittle if the wording or `getErrorMessage` format ever changes.
 */
function isAlreadyCheckedIn(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { statusCode?: unknown; status?: unknown };
  return e.statusCode === 409 || e.status === 409;
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
 * gate, and one-per-member uniqueness; the gating here is UX-only). A 409 is
 * treated as an idempotent "already checked in".
 */
export function EventCard({ message, isConfirmed }: EventCardProps) {
  const payload = readPayload(message);
  const { toast } = useToast();
  const checkIn = useCheckIn();
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
  const { data: attendance } = useAttendance(
    canViewAttendance ? eventId : "",
  );
  const now = useNow();

  if (!payload) {
    return (
      <div className="mt-1 whitespace-pre-wrap break-words text-sm">
        {message.content}
      </div>
    );
  }

  const checkedIn = countCheckedIn(attendance);
  const start = new Date(payload.start_time).getTime();
  const end = new Date(payload.end_time).getTime();
  const windowOpen =
    Number.isFinite(start) &&
    Number.isFinite(end) &&
    now >= start &&
    now <= end + CHECK_IN_GRACE_MS;
  const actionsDisabled = !isConfirmed || checkIn.isPending;

  const handleCheckIn = async (): Promise<void> => {
    try {
      // No token and no coordinates: this is the plain self check-in surface.
      // For an event that defines a check-in geofence the server rejects that
      // with a message naming the mobile app, which the catch below renders.
      await checkIn.mutateAsync({ eventId: payload.event_id });
      toast({
        title: "Checked in",
        description: payload.point_value
          ? `+${payload.point_value} pts`
          : undefined,
      });
    } catch (error) {
      const alreadyIn = isAlreadyCheckedIn(error);
      const detail = getErrorMessage(error, "Couldn't check in.");
      toast({
        title: alreadyIn ? "Already checked in" : "Couldn't check in",
        description: alreadyIn
          ? "You're already on the attendance list for this event."
          : detail,
        variant: alreadyIn ? "default" : "destructive",
      });
    }
  };

  return (
    <div className="mt-1 rounded-md border-l-4 border-[color:var(--side-accent,#7A5A2F)] bg-[color:var(--mention-bg,theme(colors.amber.50))] px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-[color:var(--side-accent,#7A5A2F)]">
          <CalendarDays className="h-3 w-3" aria-hidden="true" /> Event
        </div>
        {payload.is_mandatory ? (
          <Badge variant="default">Mandatory</Badge>
        ) : null}
      </div>
      <p className="mt-1 text-sm font-medium">{payload.name}</p>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span>{formatRange(payload.start_time, payload.end_time)}</span>
        {payload.location ? (
          <>
            <span aria-hidden="true">·</span>
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3 w-3" aria-hidden="true" />
              {payload.location}
            </span>
          </>
        ) : null}
        {payload.point_value ? (
          <Badge variant="outline">+{payload.point_value} pts</Badge>
        ) : null}
      </div>
      {canViewAttendance ? (
        <p className="mt-1 text-xs text-muted-foreground">
          {checkedIn === 1 ? "1 checked in" : `${checkedIn} checked in`}
        </p>
      ) : null}
      {windowOpen ? (
        <div className="mt-2 flex flex-wrap gap-2">
          <Button
            size="sm"
            {...gate.controlProps(actionsDisabled)}
            onClick={() => void handleCheckIn()}
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
    </div>
  );
}
