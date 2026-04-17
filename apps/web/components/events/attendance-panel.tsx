"use client";

import { useMemo, useState } from "react";
import { AlertCircle, Loader2, UsersRound } from "lucide-react";
import {
  useAttendance,
  useAutoAbsent,
  useMembers,
  useUpdateAttendanceStatus,
} from "@repo/hooks";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/shared/async-states";
import { useToast } from "@/hooks/use-toast";
import { asArray } from "@/lib/utils";
import { useRealtimeTable } from "@/lib/realtime/use-realtime-table";
import { Can } from "@/components/shared/can";

type AttendanceStatus = "PRESENT" | "EXCUSED" | "ABSENT" | "LATE";

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

const STATUS_LABELS: Record<AttendanceStatus, string> = {
  PRESENT: "Present",
  EXCUSED: "Excused",
  ABSENT: "Absent",
  LATE: "Late",
};

function statusVariant(
  status: AttendanceStatus | "UNRECORDED",
): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "PRESENT":
      return "default";
    case "LATE":
      return "secondary";
    case "EXCUSED":
      return "outline";
    case "ABSENT":
      return "destructive";
    default:
      return "outline";
  }
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString();
}

export function AttendancePanel({ eventId }: { eventId: string }) {
  const { toast } = useToast();
  const attendanceQuery = useAttendance(eventId);
  const membersQuery = useMembers();
  const updateStatus = useUpdateAttendanceStatus();
  const autoAbsent = useAutoAbsent();

  const [statusFilter, setStatusFilter] =
    useState<"ALL" | AttendanceStatus | "UNRECORDED">("ALL");

  // Live updates: other admins marking attendance or members checking in
  // appear without a manual refresh. Invalidate the event detail too so
  // aggregate counts stay consistent.
  useRealtimeTable({
    table: "event_attendance",
    filter: `event_id=eq.${eventId}`,
    invalidate: [
      ["attendance", eventId],
      ["events", eventId],
    ],
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
        description: `${STATUS_LABELS[next]} recorded for this member.`,
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

  if (attendanceQuery.isPending) {
    return <LoadingState message="Loading attendance..." />;
  }

  if (attendanceQuery.isError) {
    return (
      <ErrorState
        title="Attendance unavailable"
        description="Couldn't load attendance for this event. Retry or confirm you have events:update or permission to view attendance."
        onRetry={() => void attendanceQuery.refetch()}
      />
    );
  }

  if (rows.length === 0) {
    return (
      <EmptyState
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
    <Card>
      <CardHeader className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2 text-lg">
            <UsersRound className="h-4 w-4 text-muted-foreground" />
            Attendance
          </CardTitle>
          <CardDescription>
            {counts.PRESENT + counts.LATE} checked in · {counts.EXCUSED} excused ·
            {" "}
            {counts.ABSENT} absent · {counts.UNRECORDED} unrecorded
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
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
              variant="outline"
              size="sm"
              disabled={autoAbsent.isPending}
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
      </CardHeader>
      <CardContent className="space-y-3">
        {filteredRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No members match that filter.
          </p>
        ) : (
          <ul className="divide-y divide-border/70">
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
                  <Badge variant={statusVariant(row.status)}>
                    {row.status === "UNRECORDED"
                      ? "Unrecorded"
                      : STATUS_LABELS[row.status]}
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
                      value={
                        row.status === "UNRECORDED" ? "" : row.status
                      }
                      onValueChange={(value) => {
                        if (!value) return;
                        void changeStatus(
                          row.userId,
                          value as AttendanceStatus,
                          row.status,
                        );
                      }}
                    >
                      <SelectTrigger
                        className="w-[150px]"
                        aria-label={`Update attendance for ${row.displayName}`}
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
      </CardContent>
    </Card>
  );
}
