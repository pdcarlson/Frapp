"use client";

import { Check, Loader2 } from "lucide-react";
import {
  selectOwnAttendance,
  useMyAttendance,
  useNow,
  type OwnAttendanceRow,
} from "@repo/hooks";
import { checkInWindowBounds, isValidZoneOutline } from "@repo/validation";
import {
  formatRelativeDayTime,
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
import { useSelfCheckIn } from "@/lib/hooks/use-self-check-in";
import { checkInLabel, pointsLabel } from "@/components/events/event-labels";
import { attendanceStatusLabel } from "@/components/events/attendance-status";

/**
 * Where the event's check-in leaves a web viewer: `none` is the one state web
 * can check in from. `code` is an event with no zone whose check-in now needs
 * the code on an officer's screen, which web can't scan (#4808).
 */
export type ZoneState = "none" | "zone" | "malformed" | "code";

/**
 * An event's `check_in_zone`, and its read's `check_in_needs_code`, as a
 * {@link ZoneState}. An outline that isn't a usable polygon is not "no zone",
 * because the server (`isValidZone`, which runs `isValidZoneOutline`) then
 * refuses every check-in, so calling it "check in from anywhere" would say the
 * opposite of what members get. The same check the server runs. A zone wins
 * over the code: its line already sends the member to the phone. Only an
 * explicit `true` is the code (a read from before the field says nothing).
 * The event sheet and the chat event card both read it.
 */
export function checkInZoneState(
  zone: unknown,
  needsCode: unknown = false,
): ZoneState {
  if (zone === null || zone === undefined) {
    return needsCode === true ? "code" : "none";
  }
  return isValidZoneOutline(zone) ? "zone" : "malformed";
}

/**
 * What an open check-in says when web can't take it: the sheet's detail line,
 * and the chat card's note in place of its Check in button.
 */
export const ZONE_CHECK_IN_LINE: Record<Exclude<ZoneState, "none">, string> = {
  zone: "This event checks your location, so check in from the Frapp mobile app.",
  malformed:
    "This event's check-in zone is incomplete, so check-in isn't working. Ask an officer to fix it.",
  // The words the server's `needs_code` refusal shows (`error-copy.ts`).
  code: "Point your phone's camera at the code on the officer's screen to check in.",
};

export type MyCheckInView =
  | { kind: "loading" }
  /** `label` is `null` just after this session's own check-in, before the row is re-read. */
  | { kind: "checked-in"; label: string | null }
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
 * - A check-in this session just made counts as one while the row is being
 *   re-read, so Check in doesn't come back for a second click that can only
 *   be refused.
 * - An event that can't be read (deleted, or out of reach) offers nothing.
 * - With no row, the window decides (`checkInWindowBounds`, the rule the API
 *   enforces). Held as `loading` while the row is first read, so a member
 *   already in never sees Check in flash. A failed read falls through to the
 *   window, as mobile's does: the server refuses a repeat with a 409 anyway.
 */
export function myCheckInView({
  own,
  ownLoading,
  justCheckedIn = false,
  eventUnavailable = false,
  start,
  end,
  opensMinutes,
  zone,
  now,
}: {
  own: OwnAttendanceRow | null;
  ownLoading: boolean;
  justCheckedIn?: boolean;
  eventUnavailable?: boolean;
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
  if (justCheckedIn) return { kind: "checked-in", label: null };
  if (eventUnavailable) return { kind: "unavailable" };
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

/**
 * `"7:50 PM"` today; otherwise the shared relative day, mid-sentence:
 * `"tomorrow · 7:50 PM"`, `"Friday · 7:50 PM"`, `"Nov 14 · 7:50 PM"`, as
 * mobile's card says tomorrow and a weekday within the week.
 */
function clockLabel(at: Date, now: Date): string {
  const iso = at.toISOString();
  if (localIsoDate(at) === localIsoDate(now)) return formatTimeOfDay(iso);
  const relative = formatRelativeDayTime(iso, now);
  if (!relative) return formatTimeOfDay(iso);
  return relative.replace(/^(Tomorrow|Yesterday)\b/, (word) =>
    word.toLowerCase(),
  );
}

/**
 * The viewer's own check-in for one event: any member may read their own row
 * (`GET /v1/events/:eventId/attendance/me`), unlike the `events:update`
 * roster, so this is what a member sees on the event sheet (#3855). Check in
 * is the chat card's (`useSelfCheckIn`): no token and no coordinates, so an
 * event with a check-in zone, which needs the member's location, says to use
 * the mobile app instead, and one whose check-in needs the officer's code
 * says to scan it (`spec/behavior/events.md` § Check-In). Live updates
 * arrive through the sheet's `attendance:<eventId>` subscription.
 */
export function MyCheckIn({
  eventId,
  start,
  end,
  opensMinutes,
  pointValue,
  zone,
  eventUnavailable = false,
}: {
  eventId: string;
  start: unknown;
  end: unknown;
  opensMinutes: unknown;
  pointValue: unknown;
  zone: ZoneState;
  /** The event's own read failed (deleted, or out of reach). */
  eventUnavailable?: boolean;
}) {
  const mine = useMyAttendance(eventId);
  const checkIn = useSelfCheckIn();
  // `POST …/attendance/check-in` carries no `@FreeTier`, so it is paid-ops,
  // as on the chat card (#841).
  const gate = useSubscriptionGate();
  const now = new Date(useNow());

  const view = myCheckInView({
    own: selectOwnAttendance(mine.data),
    justCheckedIn: checkIn.checkedInEventId === eventId,
    eventUnavailable,
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
      title = view.label ?? "Checked in";
      detail = points;
      break;
    case "marked":
      title = view.label;
      break;
    case "open":
      title = "Check-in is open";
      detail =
        view.zone === "none"
          ? `Closes ${clockLabel(view.closesAt, now)}`
          : ZONE_CHECK_IN_LINE[view.zone];
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
            onClick={() => void checkIn.run(eventId, pointValue)}
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
