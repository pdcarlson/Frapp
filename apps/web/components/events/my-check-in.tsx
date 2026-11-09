"use client";

import { Check, Loader2 } from "lucide-react";
import { statusOf } from "@repo/api-sdk";
import { useCheckIn, useMyAttendance, useNow } from "@repo/hooks";
import { checkInWindowBounds } from "@repo/validation";
import {
  formatDayTime,
  formatTimeOfDay,
  localIsoDate,
  parseInstant,
} from "@repo/formatting";
import { Button } from "@/components/ui/button";
import { SkeletonText } from "@/components/shared/async-states";
import { SectionSkeleton } from "@/components/shared/page-skeletons";
import {
  SubscriptionNotice,
  useSubscriptionGate,
} from "@/components/shared/subscription-gate";
import { useToast } from "@/lib/hooks/use-toast";
import { getErrorMessage } from "@/lib/utils";
import { checkInLabel, pointsLabel } from "@/components/events/event-labels";
import {
  attendanceStatusLabel,
  type AttendanceStatus,
} from "@/components/events/attendance-status";

/** The viewer's own row, as `GET …/attendance/me` answers it. */
export type OwnAttendance = {
  status: AttendanceStatus;
  checkInTime: string | null;
};

const STATUSES = new Set<string>(["PRESENT", "LATE", "EXCUSED", "ABSENT"]);

/**
 * `{ attendance: row | null }` → the row, or `null` when there is none or the
 * answer is unreadable. Mobile reads the same answer through its own
 * `selectMyAttendance` (`apps/mobile/lib/events/select.ts`).
 */
export function readOwnAttendance(data: unknown): OwnAttendance | null {
  if (!data || typeof data !== "object") return null;
  const row = (data as { attendance?: unknown }).attendance;
  if (!row || typeof row !== "object") return null;
  const { status, check_in_time } = row as Record<string, unknown>;
  if (typeof status !== "string" || !STATUSES.has(status)) return null;
  return {
    status: status as AttendanceStatus,
    checkInTime: typeof check_in_time === "string" ? check_in_time : null,
  };
}

/** Where the event's check-in zone leaves a web viewer. */
export type ZoneState = "none" | "zone" | "malformed";

export type MyCheckInView =
  | { kind: "loading" }
  | { kind: "checked-in"; label: string }
  | { kind: "marked"; label: string }
  | { kind: "open"; closesAt: Date; zone: ZoneState }
  | { kind: "upcoming"; opensAt: Date }
  | { kind: "closed" }
  | { kind: "unavailable" };

/**
 * What the viewer's own check-in block says, mobile's event page card
 * (`CheckInCard` in `apps/mobile/app/(app)/event-details.tsx`) read for web:
 *
 * - A check-in on record (PRESENT or LATE with a time) says when.
 * - Any other row is an officer's mark ("Marked excused"), and offers no
 *   check-in: the server refuses a second row, so a button could only answer
 *   "already checked in".
 * - With no row, the window decides (`checkInWindowBounds`, the rule the API
 *   enforces). Held as `loading` while the row is first read, so a member
 *   already in never sees Check in flash. A failed read falls through to the
 *   window, as mobile's does: the server refuses a repeat with a 409 anyway.
 */
export function myCheckInView({
  own,
  ownLoading,
  start,
  end,
  opensMinutes,
  zone,
  now,
}: {
  own: OwnAttendance | null;
  ownLoading: boolean;
  start: unknown;
  end: unknown;
  opensMinutes: unknown;
  zone: ZoneState;
  now: Date;
}): MyCheckInView {
  if (own) {
    const checkedIn =
      own.status === "PRESENT" || own.status === "LATE"
        ? checkInLabel(own.checkInTime, start, now)
        : null;
    if (checkedIn) return { kind: "checked-in", label: checkedIn };
    return {
      kind: "marked",
      label: `Marked ${attendanceStatusLabel(own.status).toLowerCase()}`,
    };
  }
  if (ownLoading) return { kind: "loading" };
  const startAt = parseInstant(start);
  const endAt = parseInstant(end);
  if (!startAt || !endAt) return { kind: "unavailable" };
  const bounds = checkInWindowBounds(startAt, endAt, opensMinutes);
  const at = now.getTime();
  if (at < bounds.opensAt.getTime()) {
    return { kind: "upcoming", opensAt: bounds.opensAt };
  }
  if (at > bounds.closesAt.getTime()) return { kind: "closed" };
  return { kind: "open", closesAt: bounds.closesAt, zone };
}

/** `"7:50 PM"` today, `"Fri, Nov 6 · 7:50 PM"` on any other day. */
function clockLabel(at: Date, now: Date): string {
  const iso = at.toISOString();
  return localIsoDate(at) === localIsoDate(now)
    ? formatTimeOfDay(iso)
    : (formatDayTime(iso, now) ?? formatTimeOfDay(iso));
}

/**
 * The viewer's own check-in for one event: any member may read their own row
 * (`GET /v1/events/:eventId/attendance/me`), unlike the `events:update`
 * roster, so this is what a member sees on the event sheet (#3855). Check in
 * sends the plain self check-in the web chat card sends, with no token and no
 * coordinates; an event with a check-in zone needs the member's location, which
 * web doesn't ask for, so it says to use the mobile app instead
 * (`spec/behavior/events.md` § Check-In).
 */
export function MyCheckIn({
  eventId,
  start,
  end,
  opensMinutes,
  pointValue,
  zone,
}: {
  eventId: string;
  start: unknown;
  end: unknown;
  opensMinutes: unknown;
  pointValue: unknown;
  zone: ZoneState;
}) {
  const mine = useMyAttendance(eventId);
  const checkIn = useCheckIn();
  // `POST …/attendance/check-in` carries no `@FreeTier`, so it is paid-ops,
  // as on the chat card (#841).
  const gate = useSubscriptionGate();
  const { toast } = useToast();
  const now = new Date(useNow());

  const view = myCheckInView({
    own: readOwnAttendance(mine.data),
    // Not while the read is paused offline: then the window is still worth
    // saying, and the server refuses a repeat anyway.
    ownLoading: mine.isPending && mine.fetchStatus !== "paused",
    start,
    end,
    opensMinutes,
    zone,
    now,
  });
  const points = pointsLabel(pointValue);

  const handleCheckIn = async (): Promise<void> => {
    try {
      await checkIn.mutateAsync({ eventId });
      toast({
        title: "Checked in",
        description:
          typeof pointValue === "number" && pointValue > 0
            ? `+${pointValue} pts`
            : undefined,
      });
    } catch (error) {
      // A repeat is answered 409 by decision (#3703): you're in. `useCheckIn`
      // re-reads this row on it, so the block turns to "Checked in".
      const alreadyIn = statusOf(error) === 409;
      toast({
        title: alreadyIn ? "Already checked in" : "Couldn't check in",
        description: alreadyIn
          ? "You're already on the attendance list for this event."
          : getErrorMessage(error, "Couldn't check in."),
        variant: alreadyIn ? "default" : "destructive",
      });
    }
  };

  if (view.kind === "loading") {
    return (
      <SectionSkeleton
        label="Loading your check-in"
        className="rounded-lg border border-border p-3"
      >
        <SkeletonText lines={1} />
      </SectionSkeleton>
    );
  }

  let title: string;
  let detail: string | null = null;
  switch (view.kind) {
    case "checked-in":
      title = view.label;
      detail = points;
      break;
    case "marked":
      title = view.label;
      break;
    case "open":
      title = "Check-in is open";
      detail =
        view.zone === "zone"
          ? "This event checks your location, so check in from the Frapp mobile app."
          : view.zone === "malformed"
            ? "This event's check-in zone is incomplete, so check-in isn't working. Ask an officer to fix it."
            : `Closes ${clockLabel(view.closesAt, now)}`;
      break;
    case "upcoming":
      title = `Check-in opens ${clockLabel(view.opensAt, now)}`;
      break;
    case "closed":
      title = "Check-in is closed";
      break;
    default:
      title = "Check-in is unavailable";
  }

  const canCheckIn = view.kind === "open" && view.zone === "none";

  return (
    <section
      aria-label="Your check-in"
      className="rounded-lg border border-border p-3"
    >
      <p className="mb-1 text-caption text-muted-foreground">Your check-in</p>
      <p className="text-sm font-semibold">{title}</p>
      {detail ? (
        <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
      ) : null}
      {canCheckIn ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            size="sm"
            {...gate.controlProps(checkIn.isPending)}
            onClick={() => void handleCheckIn()}
          >
            {checkIn.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Check className="h-4 w-4" aria-hidden="true" />
            )}
            Check in
          </Button>
          <SubscriptionNotice
            gate={gate}
            feature="event check-in"
            className="mb-0 w-full"
          />
        </div>
      ) : null}
    </section>
  );
}
