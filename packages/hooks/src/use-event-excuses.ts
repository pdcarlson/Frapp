"use client";

import { useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { statusOf, throwUnlessOk } from "@repo/api-sdk";
import type { components } from "@repo/api-sdk";
import {
  alumniRoleIdOf,
  checkInWindowBounds,
  eventAttendanceFor,
  eventExcuseClosesAt,
  type EventAttendanceFields,
} from "@repo/validation";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";
import { useListChapters } from "./use-chapters";
import { useRoles } from "./use-roles";
import { useMyAttendance } from "./use-attendance";

/**
 * Absence excuses for required events, on every surface
 * (`spec/behavior/events.md` § Excuses, #3735): the member's own excuse, the
 * receiver's list, and the three writes. The rules the screens follow are
 * read here once ({@link myExcuseView}), so the phone and web offer the same
 * thing at the same moment; the API enforces them either way.
 *
 * Every key sits under `["attendance", eventId]`: approving or withdrawing an
 * excuse rewrites the member's attendance row, and a check-in drops a pending
 * excuse, so one invalidation of the event's attendance refreshes both, and
 * web's `attendance:<eventId>` realtime ping reaches these reads too.
 */

export type EventExcuse = components["schemas"]["EventExcuseDto"];
export type EventExcuseWithMember =
  components["schemas"]["EventExcuseWithMemberDto"];
export type EventExcuseStatus = EventExcuse["status"];
export type MyEventExcuse = components["schemas"]["MyEventExcuseDto"];

const excuseKeys = {
  mine: (eventId: string) => ["attendance", eventId, "excuse", "me"] as const,
  list: (eventId: string) => ["attendance", eventId, "excuses"] as const,
};

/** The viewer's own excuse for an event, and who receives it. */
export function useMyEventExcuse(
  eventId: string,
  options: { enabled?: boolean } = {},
) {
  const client = useFrappClient();
  return useQuery({
    queryKey: excuseKeys.mine(eventId),
    queryFn: async (): Promise<MyEventExcuse> => {
      const result = await client.GET("/v1/events/{eventId}/excuses/me", {
        params: { path: { eventId } },
      });
      throwUnlessOk(result);
      return result.data as MyEventExcuse;
    },
    staleTime: 30_000,
    enabled: (options.enabled ?? true) && !!eventId,
  });
}

/**
 * An event's excuses, for its creator or an `events:update` holder. Anyone
 * else gets a 403, which the app's query retry policy doesn't repeat (nor a
 * 404 for an event that is gone).
 */
export function useEventExcuses(
  eventId: string,
  options: { enabled?: boolean } = {},
) {
  const client = useFrappClient();
  return useQuery({
    queryKey: excuseKeys.list(eventId),
    queryFn: async (): Promise<EventExcuseWithMember[]> => {
      const result = await client.GET("/v1/events/{eventId}/excuses", {
        params: { path: { eventId } },
      });
      throwUnlessOk(result);
      return (result.data ?? []) as EventExcuseWithMember[];
    },
    staleTime: 30_000,
    enabled: (options.enabled ?? true) && !!eventId,
  });
}

/**
 * Every write here changes what the event's attendance reads say, so each
 * invalidates the whole `["attendance", eventId]` family. A 409 means the
 * screen was behind the server (decided, withdrawn or checked in elsewhere),
 * so it re-reads too.
 */
function useExcuseWrite<V extends { eventId: string }, R>(
  name: string,
  write: (variables: V) => Promise<R>,
) {
  const queryClient = useQueryClient();
  const refresh = (eventId: string) =>
    queryClient.invalidateQueries({ queryKey: ["attendance", eventId] });
  return useMutation({
    mutationKey: ["attendance", name],
    mutationFn: write,
    onSuccess: (_data, { eventId }) => refresh(eventId),
    onError: (error, { eventId }) => {
      if (statusOf(error) === 409) void refresh(eventId);
    },
  });
}

/** Send an excuse (`{ reason }`, one line). */
export function useSendEventExcuse() {
  const client = useFrappClient();
  return useExcuseWrite(
    "excuse-send",
    async ({ eventId, reason }: { eventId: string; reason: string }) => {
      const result = await client.POST("/v1/events/{eventId}/excuses", {
        params: { path: { eventId } },
        body: { reason: reason.trim() },
      });
      throwUnlessOk(result);
      return result.data;
    },
  );
}

/** Take back the viewer's pending or approved excuse. */
export function useWithdrawEventExcuse() {
  const client = useFrappClient();
  return useExcuseWrite(
    "excuse-withdraw",
    async ({ eventId }: { eventId: string }) => {
      const result = await client.DELETE("/v1/events/{eventId}/excuses/me", {
        params: { path: { eventId } },
      });
      throwUnlessOk(result);
      return null;
    },
  );
}

/** Approve or decline a member's pending excuse. */
export function useDecideEventExcuse() {
  const client = useFrappClient();
  return useExcuseWrite(
    "excuse-decide",
    async ({
      eventId,
      userId,
      decision,
    }: {
      eventId: string;
      userId: string;
      decision: "APPROVED" | "DECLINED";
    }) => {
      const result = await client.PATCH(
        "/v1/events/{eventId}/excuses/{userId}",
        { params: { path: { eventId, userId } }, body: { decision } },
      );
      throwUnlessOk(result);
      return result.data;
    },
  );
}

/**
 * Whether an event is required of the viewer, by default or by a role of
 * theirs (`spec/behavior/events.md` § Attendance by role): what a list row's
 * Mandatory chip says, and who is offered Can't make it. The server's rule
 * (`AttendanceService.requiresMember`, with `holdsTo`): an alumnus is held
 * to an event only when one of their roles is named, never by the default
 * alone (`spec/behavior/alumni.md`). Read off the memberships list and the
 * chapter's roles, which the apps already hold, so it answers `false` while
 * the memberships load.
 */
export function useRequiredOfViewer(): (
  event: EventAttendanceFields,
) => boolean {
  const chapterId = useActiveChapterId();
  const chapters = useListChapters();
  const roles = useRoles();
  const roleIds = useMemo(
    () =>
      chapters.data?.find((membership) => membership.chapter_id === chapterId)
        ?.role_ids ?? [],
    [chapters.data, chapterId],
  );
  const alumni = useMemo(() => {
    const alumniId = alumniRoleIdOf(roles.data);
    return alumniId !== undefined && roleIds.includes(alumniId);
  }, [roles.data, roleIds]);
  // Stable while the roles hold, so a list filter that depends on it
  // (the web Events page's) doesn't recompute on every render.
  return useCallback(
    (event: EventAttendanceFields) => {
      const attendance = eventAttendanceFor(event, roleIds);
      return attendance.status === "required" && (attendance.byRole || !alumni);
    },
    [roleIds, alumni],
  );
}

/** Who the excuse goes to, as the member reads it. */
export function excuseReceiverLine(
  receiver: MyEventExcuse["receiver"],
): string {
  const name = receiver?.display_name.trim();
  return name ? `Excuse sent to ${name}` : "Excuse sent to the officers";
}

/**
 * Whether the viewer's own attendance row (`useMyAttendance`'s answer) already
 * settles the event, so an excuse would only be refused: a check-in, an
 * EXCUSED row, or an ABSENT an officer set. An ABSENT the sweep wrote
 * (`marked_by` null) doesn't: that is what a late excuse is for.
 */
export function attendanceSettlesExcuse(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const row = (data as { attendance?: unknown }).attendance;
  if (!row || typeof row !== "object") return false;
  const { status, marked_by } = row as Record<string, unknown>;
  if (status === "PRESENT" || status === "LATE" || status === "EXCUSED") {
    return true;
  }
  return status === "ABSENT" && typeof marked_by === "string";
}

/** What the viewer's excuse block shows for one event. */
export type MyExcuseView =
  /** Nothing: not required, settled, past the window, or still loading. */
  | { kind: "none" }
  /** Can't make it. */
  | { kind: "offer" }
  | {
      kind: "sent";
      status: EventExcuseStatus;
      reason: string;
      /** "Excuse sent to Jake", "Excused", "Excuse not accepted". */
      title: string;
      /** The pending excuse's receiver, or the decision's reason line. */
      detail: string | null;
      canWithdraw: boolean;
    };

/**
 * The member's excuse block, read from their excuse, their attendance row and
 * the clock, in the server's terms (`EventExcuseService`):
 *
 * - **Only on an event that requires them.** On an optional one "Can't make
 *   it" is the RSVP (#1035), not this.
 * - **An excuse on record** says where it stands: pending names its receiver,
 *   approved says Excused, declined says it wasn't accepted. Pending and
 *   approved can be withdrawn until check-in closes; a declined one can't.
 * - **No excuse yet** offers Can't make it until 48 hours after the end
 *   (`eventExcuseClosesAt`), unless their row already settles it
 *   ({@link attendanceSettlesExcuse}).
 * - Held at `none` while either read has no answer (loading, failed, or
 *   paused offline): without one the screen can't tell a member who already
 *   sent one, or checked in, from one who hasn't, and offering the button to
 *   them would only earn a 409.
 */
export function myExcuseView({
  required,
  mine,
  mineUnanswered,
  ownAttendance,
  ownUnanswered,
  start,
  end,
  opensMinutes,
  now,
}: {
  required: boolean;
  mine: MyEventExcuse | undefined;
  mineUnanswered: boolean;
  ownAttendance: unknown;
  ownUnanswered: boolean;
  start: unknown;
  end: unknown;
  opensMinutes: unknown;
  now: Date;
}): MyExcuseView {
  const excuse = mine?.excuse ?? null;
  const endAt = typeof end === "string" ? new Date(end) : null;
  const startAt = typeof start === "string" ? new Date(start) : null;
  const valid =
    endAt && startAt && !isNaN(endAt.getTime()) && !isNaN(startAt.getTime());
  if (excuse) {
    const checkInOpen =
      valid &&
      now.getTime() <=
        checkInWindowBounds(startAt, endAt, opensMinutes).closesAt.getTime();
    switch (excuse.status) {
      case "PENDING":
        return {
          kind: "sent",
          status: "PENDING",
          reason: excuse.reason,
          title: excuseReceiverLine(mine?.receiver ?? null),
          detail: "Waiting for a decision",
          canWithdraw: Boolean(checkInOpen),
        };
      case "APPROVED":
        return {
          kind: "sent",
          status: "APPROVED",
          reason: excuse.reason,
          title: "Excused",
          detail: null,
          canWithdraw: Boolean(checkInOpen),
        };
      default:
        return {
          kind: "sent",
          status: "DECLINED",
          reason: excuse.reason,
          title: "Excuse not accepted",
          detail: "You're still expected at this event.",
          canWithdraw: false,
        };
    }
  }
  if (!required || mineUnanswered || ownUnanswered || !valid)
    return { kind: "none" };
  if (attendanceSettlesExcuse(ownAttendance)) return { kind: "none" };
  if (now.getTime() > eventExcuseClosesAt(endAt).getTime()) {
    return { kind: "none" };
  }
  return { kind: "offer" };
}

/** Who is looking at the receiver's list, for {@link canDecideExcuse}. */
export interface ExcuseDecider {
  viewerId: string | null;
  /** Holds `events:update`, which decides any excuse, their own included. */
  canUpdateEvents: boolean;
}

/**
 * Whether the viewer may approve or decline this excuse, by the server's
 * rule (`EventExcuseService.canDecide`): a pending one, and not their own
 * unless they hold `events:update`. The creator's own excuse goes to the
 * officers, so on the creator's list it is shown without buttons.
 */
export function canDecideExcuse(
  excuse: Pick<EventExcuse, "status" | "user_id">,
  decider: ExcuseDecider,
): boolean {
  if (excuse.status !== "PENDING") return false;
  return decider.canUpdateEvents || excuse.user_id !== decider.viewerId;
}

/**
 * The receiver's summary line for an event: "2 to decide · 12 excused", from
 * the list itself: the pending excuses this viewer can decide, and the
 * approved ones (an officer's own EXCUSED marks show on web's roster beside
 * it).
 */
export function excuseSummaryLine(
  excuses: readonly Pick<EventExcuse, "status" | "user_id">[],
  decider: ExcuseDecider,
): string | null {
  const pending = excuses.filter((e) => canDecideExcuse(e, decider)).length;
  const excused = excuses.filter((e) => e.status === "APPROVED").length;
  const parts = [
    pending > 0 ? `${pending} to decide` : null,
    excused > 0 ? `${excused} excused` : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** The receiver's order: pending first, then decided; oldest first within each. */
export function sortExcusesForReview<
  T extends Pick<EventExcuse, "status" | "created_at">,
>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    const pa = a.status === "PENDING" ? 0 : 1;
    const pb = b.status === "PENDING" ? 0 : 1;
    if (pa !== pb) return pa - pb;
    return a.created_at.localeCompare(b.created_at);
  });
}

/** What a chat event card knows about its event (`EventPayload`'s fields). */
export interface ExcuseCardEvent extends EventAttendanceFields {
  event_id: string;
  start_time: string;
  end_time: string;
  check_in_opens_minutes: number;
  /**
   * The server's own answer for this viewer, when the card has one (the
   * Activity page's built message); it wins over the role fields.
   */
  viewer_required?: boolean;
}

/**
 * Whether a chat event card's event requires the viewer: the card's own
 * `viewer_required` when it carries one, else its role fields through
 * `requiredOf` ({@link useRequiredOfViewer}; a card posted before them goes
 * by `is_mandatory`). The card's Mandatory badge (#4132) and its Can't make
 * it offer ({@link useEventCardExcuse}) both read it, so they never disagree.
 */
export function eventCardRequiresViewer(
  card: Pick<ExcuseCardEvent, "viewer_required"> & EventAttendanceFields,
  requiredOf: (event: EventAttendanceFields) => boolean,
): boolean {
  return card.viewer_required ?? requiredOf(card);
}

/**
 * The excuse view for a chat event card (#4660): {@link myExcuseView} over
 * the card's snapshot, so the card offers Can't make it, or says where an
 * excuse stands, as the event page would while the excuse window is open.
 * Once it closes the card says nothing more about excuses (the event page
 * still shows a sent one), so an old card in a long history never reads.
 *
 * A channel holds many cards, so whether the event requires the viewer comes
 * from the card itself: `viewer_required` when it carries one, else its role
 * fields through `requiredOf`, the card's own {@link useRequiredOfViewer} (a
 * card posted before them goes by `is_mandatory`), which its Mandatory badge
 * reads too (#4132), so the card asks once. That rule reads the viewer's
 * memberships and the chapter's roles, one shared cached read each. The two
 * reads the view needs (the viewer's excuse and attendance row) run only for
 * a card that requires them, until its excuse window closes. Pass `null` for
 * a card whose payload didn't read.
 */
export function useEventCardExcuse(
  card: ExcuseCardEvent | null,
  now: Date,
  requiredOf: (event: EventAttendanceFields) => boolean,
): MyExcuseView {
  const end = card ? new Date(card.end_time) : null;
  const windowOpen =
    !!end &&
    !isNaN(end.getTime()) &&
    now.getTime() <= eventExcuseClosesAt(end).getTime();
  const required =
    !!card && windowOpen && eventCardRequiresViewer(card, requiredOf);
  const eventId = required ? card.event_id : "";
  const mine = useMyEventExcuse(eventId, { enabled: required });
  const own = useMyAttendance(eventId, { enabled: required });
  if (!required) return { kind: "none" };
  return myExcuseView({
    required,
    mine: mine.data,
    mineUnanswered: mine.data === undefined,
    ownAttendance: own.data,
    ownUnanswered: own.data === undefined,
    start: card.start_time,
    end: card.end_time,
    opensMinutes: card.check_in_opens_minutes,
    now,
  });
}
