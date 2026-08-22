"use client";

import { useMemo, useState } from "react";
import { AlertCircle, Loader2, UsersRound } from "lucide-react";
import {
  useActiveChapterId,
  useAttendance,
  useAutoAbsent,
  useMembers,
  useUpdateAttendanceStatus,
} from "@repo/hooks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  NestedEmpty,
  NestedError,
  NestedLoading,
} from "@/components/shared/nested-states";
import {
  SubscriptionNotice,
  useSubscriptionGate,
} from "@/components/shared/subscription-gate";
import { useToast } from "@/hooks/use-toast";
import { formatLocaleDateTime as formatDate } from "@repo/formatting";
import { asArray } from "@/lib/utils";
import { useRealtimeTable } from "@/lib/realtime/use-realtime-table";
import { Can } from "@/components/shared/can";
import {
  attendanceStatusKind,
  attendanceStatusLabel,
} from "@/components/events/attendance-status";
import type { AttendanceStatus } from "@/components/events/attendance-status";

type AttendanceRow = {
  id?: string;
  event_id?: string;
  user_id?: string;
  status?: AttendanceStatus;
  check_in_time?: string | null;
  excuse_reason?: string | null;
};

type MemberSummary = {
  id?: string;
  user_id?: string;
  display_name?: string | null;
  email?: string | null;
};

export function AttendancePanel({ eventId }: { eventId: string }) {
  const chapterId = useActiveChapterId();
  const { toast } = useToast();
  const attendanceQuery = useAttendance(eventId);
  const membersQuery = useMembers();
  const updateStatus = useUpdateAttendanceStatus();
  const autoAbsent = useAutoAbsent();
  // `PATCH /v1/events/:eventId/attendance/:userId` and the auto-absent POST
  // carry no `@FreeTier`, so both are paid-ops and mirror the gate (#841).
  // Reading attendance stays live — `enforceSubscription` returns early for
  // GET, so a lapsed chapter can still see who showed up.
  const gate = useSubscriptionGate();

  const [statusFilter, setStatusFilter] = useState<
    "ALL" | AttendanceStatus | "UNRECORDED"
  >("ALL");

  // Live updates: other admins marking attendance or members checking in
  // appear without a manual refresh. Invalidate the event detail too so
  // aggregate counts stay consistent.
  useRealtimeTable({
    table: "event_attendance",
    scopeId: eventId,
    invalidate: useMemo(
      () => [
        ["attendance", eventId],
        // Must match useEvent(id) → ["events", chapterId, id]; ["events", id] never matches.
        ["events", chapterId, eventId],
      ],
      [chapterId, eventId],
    ),
    enabled: Boolean(eventId),
  });

  const attendance = useMemo(
    () => asArray<AttendanceRow>(attendanceQuery.data),
    [attendanceQuery.data],
  );
  const members = useMemo(
    () => asArray<MemberSummary>(membersQuery.data),
    [membersQuery.data],
  );

  const memberById = useMemo(() => {
    const map = new Map<string, MemberSummary>();
    for (const member of members) {
      if (member.user_id) {
        map.set(String(member.user_id), member);
      }
    }
    return map;
  }, [members]);

  type Row = {
    userId: string;
    displayName: string;
    email: string;
    status: AttendanceStatus | "UNRECORDED";
    checkInTime: string | null;
    excuseReason: string | null;
    attendanceId: string | null;
  };

  const rows: Row[] = useMemo(() => {
    const result = new Map<string, Row>();

    for (const member of members) {
      if (!member.user_id) continue;
      result.set(String(member.user_id), {
        userId: String(member.user_id),
        displayName: member.display_name ?? "Unnamed member",
        email: member.email ?? "",
        status: "UNRECORDED",
        checkInTime: null,
        excuseReason: null,
        attendanceId: null,
      });
    }

    for (const entry of attendance) {
      const userId = entry.user_id ? String(entry.user_id) : "";
      if (!userId) continue;
      const base =
        result.get(userId) ??
        ({
          userId,
          displayName:
            memberById.get(userId)?.display_name ?? "Non-member attendee",
          email: memberById.get(userId)?.email ?? "",
          status: "UNRECORDED" as const,
          checkInTime: null,
          excuseReason: null,
          attendanceId: null,
        } as Row);

      result.set(userId, {
        ...base,
        status: entry.status ?? "UNRECORDED",
        checkInTime: entry.check_in_time ?? null,
        excuseReason: entry.excuse_reason ?? null,
        attendanceId: entry.id ? String(entry.id) : null,
      });
    }

    return Array.from(result.values()).sort((a, b) =>
      a.displayName.localeCompare(b.displayName),
    );
  }, [attendance, memberById, members]);

  const filteredRows = rows.filter((row) =>
    statusFilter === "ALL" ? true : row.status === statusFilter,
  );

  async function changeStatus(
    userId: string,
    next: AttendanceStatus,
    previous: AttendanceStatus | "UNRECORDED",
  ) {
    try {
      await updateStatus.mutateAsync({
        eventId,
        userId,
        body: { status: next },
      });
      toast({
        title: "Attendance updated",
        description: `${attendanceStatusLabel(next)} recorded for this member.`,
      });
    } catch (error) {
      toast({
        title: "Couldn't update attendance",
        description:
          error instanceof Error
            ? error.message
            : "Retry in a moment — your change hasn't been saved.",
        variant: "destructive",
      });
      throw error;
    }
    return previous;
  }

  async function runAutoAbsent() {
    try {
      await autoAbsent.mutateAsync(eventId);
      toast({
        title: "Auto-absent marking complete",
        description:
          "Members required to attend who weren't checked in or excused are now ABSENT.",
      });
    } catch (error) {
      toast({
        title: "Couldn't run auto-absent",
        description:
          error instanceof Error
            ? error.message
            : "Check your permissions and retry.",
        variant: "destructive",
      });
    }
  }

  if (attendanceQuery.isLoading || membersQuery.isLoading) {
    return <NestedLoading message="Loading attendance..." />;
  }

  if (attendanceQuery.isError) {
    return (
      <NestedError
        title="Attendance unavailable"
        description="Couldn't load attendance for this event. Retry or confirm you have events:update or permission to view attendance."
        onRetry={() => void attendanceQuery.refetch()}
      />
    );
  }

  /*
   * The roster is the other half of every row, and its failure used to be
   * silent: `rows` is built from `members`, so a failed `useMembers` produced
   * an empty list and the panel rendered "No attendance records yet" — copy
   * asserting that nobody has checked in, at the one moment we cannot know.
   * README §4 wants an error with a retry path, and this is one.
   */
  if (membersQuery.isError) {
    return (
      <NestedError
        title="Attendance unavailable"
        description="Couldn't load the chapter roster, so attendance can't be shown against it. Retry in a moment."
        onRetry={() => void membersQuery.refetch()}
      />
    );
  }

  if (rows.length === 0) {
    return (
      <NestedEmpty
        title="No attendance records yet"
        description="Once members check in — or you record attendance manually — they'll show up here."
      />
    );
  }

  const counts: Record<AttendanceStatus | "UNRECORDED", number> = {
    PRESENT: 0,
    LATE: 0,
    EXCUSED: 0,
    ABSENT: 0,
    UNRECORDED: 0,
  };
  for (const row of rows) counts[row.status] += 1;

  return (
    <section className="rounded-lg border border-border p-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="flex items-center gap-2 text-lg font-semibold">
            <UsersRound className="h-4 w-4 text-muted-foreground" />
            Attendance
          </h3>
          <p className="text-sm text-muted-foreground">
            {counts.PRESENT + counts.LATE} checked in · {counts.EXCUSED} excused
            · {counts.ABSENT} absent · {counts.UNRECORDED} unrecorded
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Not gated: filtering is a read, and §5 gates writes only. */}
          <Select
            value={statusFilter}
            onValueChange={(value) =>
              setStatusFilter(value as typeof statusFilter)
            }
          >
            <SelectTrigger
              className="w-[180px]"
              aria-label="Filter attendance by status"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All members</SelectItem>
              <SelectItem value="PRESENT">Present</SelectItem>
              <SelectItem value="LATE">Late</SelectItem>
              <SelectItem value="EXCUSED">Excused</SelectItem>
              <SelectItem value="ABSENT">Absent</SelectItem>
              <SelectItem value="UNRECORDED">Unrecorded</SelectItem>
            </SelectContent>
          </Select>
          <Can permission="events:update">
            <Button
              variant="secondary"
              size="sm"
              {...gate.controlProps(autoAbsent.isPending)}
              onClick={runAutoAbsent}
            >
              {autoAbsent.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <AlertCircle className="h-4 w-4" />
              )}
              Run auto-absent
            </Button>
          </Can>
        </div>
      </div>
      <div className="mt-4 space-y-3">
        {/*
          Disable, don't hide (§5 rule 4): the roster, the counts, and the
          filter keep working for a lapsed chapter — only recording attendance
          stops, and this says why.
        */}
        {/*
          Scoped to the same permission as the controls it describes. A member
          with attendance read access but not `events:update` sees the "View
          only" fallback on every row and no auto-absent button — an explanation
          for restoring writes they could never perform is pure noise, and its
          `aria-describedby` id would have nothing pointing at it.
        */}
        <Can permission="events:update">
          <SubscriptionNotice gate={gate} feature="managing events" />
        </Can>
        {filteredRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No members match that filter.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {filteredRows.map((row) => (
              <li
                key={row.userId}
                className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {row.displayName}
                  </p>
                  {row.email ? (
                    <p className="truncate text-xs text-muted-foreground">
                      {row.email}
                    </p>
                  ) : null}
                  {row.status === "PRESENT" || row.status === "LATE" ? (
                    <p className="text-xs text-muted-foreground">
                      Checked in: {formatDate(row.checkInTime)}
                    </p>
                  ) : null}
                  {row.status === "EXCUSED" && row.excuseReason ? (
                    <p className="text-xs text-muted-foreground">
                      Reason: {row.excuseReason}
                    </p>
                  ) : null}
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant={attendanceStatusKind(row.status)}>
                    {attendanceStatusLabel(row.status)}
                  </Badge>
                  <Can
                    permission="events:update"
                    deniedFallback={
                      <span className="text-xs text-muted-foreground">
                        View only
                      </span>
                    }
                  >
                    <Select
                      value={row.status === "UNRECORDED" ? "" : row.status}
                      onValueChange={(value) => {
                        if (!value) return;
                        void changeStatus(
                          row.userId,
                          value as AttendanceStatus,
                          row.status,
                        );
                      }}
                    >
                      {/*
                        The per-row status write hits the same guard as
                        auto-absent, so gating only the header button would
                        have the panel claim writes are blocked while still
                        offering one per member. The props go on the trigger
                        rather than the Radix root — the root is not a DOM
                        node, so `aria-describedby` would be dropped there.
                      */}
                      <SelectTrigger
                        className="w-[150px]"
                        aria-label={`Update attendance for ${row.displayName}`}
                        {...gate.controlProps()}
                      >
                        <SelectValue placeholder="Set status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="PRESENT">Present</SelectItem>
                        <SelectItem value="LATE">Late</SelectItem>
                        <SelectItem value="EXCUSED">Excused</SelectItem>
                        <SelectItem value="ABSENT">Absent</SelectItem>
                      </SelectContent>
                    </Select>
                  </Can>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
