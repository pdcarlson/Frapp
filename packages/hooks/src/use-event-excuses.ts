"use client";

import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { statusOf, throwUnlessOk } from "@repo/api-sdk";
import type { components } from "@repo/api-sdk";
import {
  checkInWindowBounds,
  eventAttendanceFor,
  eventExcuseClosesAt,
  type EventAttendanceFields,
} from "@repo/validation";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";
import { useListChapters } from "./use-chapters";

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
 * An event's excuses, for its creator or an `events:update` holder (anyone
 * else gets a 403, which is not retried).
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
    retry: (count, error) => statusOf(error) !== 403 && count < 2,
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
 * Mandatory chip says, and who is offered Can't make it. Read off the
 * memberships list the apps already hold, so it answers `false` while that
 * loads. The server's rule (`AttendanceService.requiresMember`) still
 * decides who may send an excuse.
 */
export function useRequiredOfViewer(): (
  event: EventAttendanceFields,
) => boolean {
  const chapterId = useActiveChapterId();
  const chapters = useListChapters();
  const roleIds = useMemo(
    () =>
      chapters.data?.find((membership) => membership.chapter_id === chapterId)
        ?.role_ids ?? [],
    [chapters.data, chapterId],
  );
  return (event) => eventAttendanceFor(event, roleIds).status === "required";
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
 * - Held at `none` while either read is first loading, so the button never
 *   flashes for a member who already sent one.
 */
export function myExcuseView({
  required,
  mine,
  mineLoading,
  ownAttendance,
  ownLoading,
  start,
  end,
  opensMinutes,
  now,
}: {
  required: boolean;
  mine: MyEventExcuse | undefined;
  mineLoading: boolean;
  ownAttendance: unknown;
  ownLoading: boolean;
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
  if (!required || mineLoading || ownLoading || !valid) return { kind: "none" };
  if (attendanceSettlesExcuse(ownAttendance)) return { kind: "none" };
  if (now.getTime() > eventExcuseClosesAt(endAt).getTime()) {
    return { kind: "none" };
  }
  return { kind: "offer" };
}

/**
 * The receiver's summary line for an event: "2 to decide · 12 excused".
 * `excused` is the caller's count: the approved excuses on the list (an
 * officer's own EXCUSED marks show on web's roster beside it).
 */
export function excuseSummaryLine(
  excuses: readonly Pick<EventExcuse, "status">[],
  excused: number,
): string | null {
  const pending = excuses.filter((e) => e.status === "PENDING").length;
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
