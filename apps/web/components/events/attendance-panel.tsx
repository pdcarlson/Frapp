"use client";

import { describeLoadFailure } from "@repo/hooks/error-copy";
import { useId, useMemo, useState } from "react";
import { Loader2, Search, UserX } from "lucide-react";
import { ATTENDANCE_SEARCH_FROM } from "@repo/validation";
import {
  useAttendance,
  useAutoAbsent,
  useMembers,
  useNow,
  useUpdateAttendanceStatus,
} from "@repo/hooks";
import { memberFallbackLabel, memberLabel } from "@repo/hooks/display-names";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SegmentedChoice } from "@/components/ui/segmented";
import { NestedError, NestedLoading } from "@/components/shared/nested-states";
import {
  SubscriptionNotice,
  useSubscriptionGate,
} from "@/components/shared/subscription-gate";
import { toastFailure } from "@/lib/failure-toast";
import { useToast } from "@/lib/hooks/use-toast";
import { asArray, getErrorMessage } from "@/lib/utils";
import { Can } from "@/components/shared/can";
import {
  attendanceStatusKind,
  attendanceStatusLabel,
} from "@/components/events/attendance-status";
import type { AttendanceStatus } from "@/components/events/attendance-status";
import { checkInLabel } from "@/components/events/event-labels";
import { formatRelativeDayTime } from "@repo/formatting";
import { checkInClosesAt } from "@/components/events/check-in-close";
import { InlineNote } from "@/components/shared/inline-note";

/** The roster's filter: everyone, checked in (present or late), or one state. */
type AttendanceFilter = "ALL" | "IN" | "EXCUSED" | "ABSENT" | "UNRECORDED";

/** The four answers an officer marks, in the order a roll call goes. */
const STATUS_OPTIONS: {
  value: AttendanceStatus | "UNRECORDED";
  label: string;
}[] = [
  { value: "PRESENT", label: "Present" },
  { value: "LATE", label: "Late" },
  { value: "EXCUSED", label: "Excused" },
  { value: "ABSENT", label: "Absent" },
];

type AttendanceRow = {
  id?: string;
  event_id?: string;
  user_id?: string;
  status?: AttendanceStatus;
  check_in_time?: string | null;
  excuse_reason?: string | null;
};

export function AttendancePanel({
  eventId,
  eventStart,
  eventEnd,
}: {
  eventId: string;
  /**
   * The event's `start_time`, so a check-in on the event's own day reads as a
   * time alone ("Checked in 5:03 PM") and one on another day names the day.
   */
  eventStart?: unknown;
  /**
   * The event's `end_time`. Auto-absent is refused (400) until check-in
   * closes, so the button waits for the same instant. Without it the button
   * is offered and the server's answer stands.
   */
  eventEnd?: unknown;
}) {
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
  const now = useNow();
  const closesAt = checkInClosesAt(eventEnd, now);
  const autoAbsentGateProps = gate.controlProps(
    autoAbsent.isPending || closesAt !== null,
  );
  /*
    Why the button waits, said in visible text: a disabled Button takes no
    pointer events, so a `title` alone is never seen. Only when the gate
    allows writes: a lapsed chapter's button stays disabled past the close,
    and its own notice says why, so a promise about the close would be false.
  */
  const waitingNoticeId = useId();
  const waitingForClose = closesAt !== null && gate.allowed;
  const autoAbsentControlProps = {
    ...autoAbsentGateProps,
    ...(waitingForClose ? { "aria-describedby": waitingNoticeId } : {}),
  };

  const [statusFilter, setStatusFilter] = useState<AttendanceFilter>("ALL");
  const [search, setSearch] = useState("");
  const needle = search.trim().toLowerCase();

  // Live updates come from the event sheet, which holds the one
  // `attendance:<eventId>` subscription for every viewer (a topic takes one
  // channel, so a second here would release the sheet's), and invalidates
  // this roster with the member's own row.

  const attendance = useMemo(
    () => asArray<AttendanceRow>(attendanceQuery.data),
    [attendanceQuery.data],
  );
  const members = useMemo(() => membersQuery.data ?? [], [membersQuery.data]);

  // An answer just clicked shows lit at once, before the roster reads it
  // back, so a run of clicks down the list doesn't flicker; a refused one
  // goes back with its toast. Cleared when the roster is read again.
  const [marked, setMarked] = useState<Record<string, AttendanceStatus>>({});
  const [markedAt, setMarkedAt] = useState(attendanceQuery.dataUpdatedAt);
  if (markedAt !== attendanceQuery.dataUpdatedAt) {
    setMarkedAt(attendanceQuery.dataUpdatedAt);
    setMarked({});
  }

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
        displayName: memberLabel(member.display_name, member.user_id),
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
      // Reached only when `result` has no row for this attendee — and `result`
      // was just built from every member with a `user_id`, so by construction
      // this attendee is not on the roster. A roster lookup here can therefore
      // only miss; it used to be one, keyed and guarded identically to the loop
      // above, which made the literals below read as a last resort rather than
      // the only outcome.
      const base =
        result.get(userId) ??
        ({
          userId,
          // A departed member, most often: the same `Member <6>` label the
          // leaderboard and task board give them, so two off-roster attendees
          // stay distinguishable rather than both reading as one phrase.
          displayName: memberFallbackLabel(userId),
          email: "",
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

    for (const [userId, status] of Object.entries(marked)) {
      const row = result.get(userId);
      if (row) result.set(userId, { ...row, status });
    }

    return Array.from(result.values()).sort((a, b) =>
      a.displayName.localeCompare(b.displayName),
    );
  }, [attendance, members, marked]);

  const filteredRows = rows.filter(
    (row) =>
      (statusFilter === "ALL"
        ? true
        : statusFilter === "IN"
          ? row.status === "PRESENT" || row.status === "LATE"
          : row.status === statusFilter) &&
      (!needle ||
        row.displayName.toLowerCase().includes(needle) ||
        row.email.toLowerCase().includes(needle)),
  );

  async function changeStatus(userId: string, next: AttendanceStatus) {
    setMarked((current) => ({ ...current, [userId]: next }));
    try {
      await updateStatus.mutateAsync({
        eventId,
        userId,
        body: { status: next },
      });
    } catch (error) {
      setMarked((current) => {
        const rest = { ...current };
        delete rest[userId];
        return rest;
      });
      toast({
        title: "Couldn't update attendance",
        description: getErrorMessage(
          error,
          "Retry in a moment. Your change hasn't been saved.",
        ),
        variant: "destructive",
      });
    }
  }

  async function runAutoAbsent() {
    try {
      await autoAbsent.mutateAsync(eventId);
      toast({
        title: "Auto-absent marking complete",
        description:
          "Members required to attend who weren't checked in or excused are now marked absent.",
      });
    } catch (error) {
      toastFailure({
        title: "Couldn't run auto-absent",
        error,
        fallback: "Try again in a moment.",
        retry: runAutoAbsent,
      });
    }
  }

  /*
   * `isPending`, not `isLoading`. `isLoading` is `isPending && isFetching`, and
   * `isFetching` is false while a query is *disabled* — `useMembers` is
   * `enabled: !!chapterId` (`packages/hooks/src/use-members.ts`). So an
   * unresolved chapter read as "not loading" on both flags, `membersQuery`
   * was not errored either (merely disabled), and the panel fell through to
   * "No attendance records yet": the same false-empty the roster branch below
   * exists to prevent, reached by another door. README §4's warning about
   * `isPending` on a disabled query is about spinning forever; here the roster
   * is genuinely not available yet, and claiming nobody checked in is worse.
   */
  if (attendanceQuery.isPending || membersQuery.isPending) {
    return (
      <div role="status" aria-live="polite" aria-busy="true">
        <NestedLoading message="Loading attendance..." />
      </div>
    );
  }

  if (attendanceQuery.isError) {
    return (
      <div role="status" aria-live="polite">
        <NestedError
          title="Attendance unavailable"
          description={`Couldn't load attendance for this event. ${describeLoadFailure(attendanceQuery.error)}`}
          onRetry={() => void attendanceQuery.refetch()}
        />
      </div>
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
      <div role="status" aria-live="polite">
        <NestedError
          title="Attendance unavailable"
          description="Couldn't load the chapter roster, so attendance can't be shown against it. Retry in a moment."
          onRetry={() => void membersQuery.refetch()}
        />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div role="status" aria-live="polite">
        <InlineNote>No attendance recorded yet.</InlineNote>
      </div>
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
  // The per-row write is gated as the bulk one is, with the same notice.
  const rowGate = gate.controlProps() as {
    disabled?: boolean;
    "aria-describedby"?: string;
  };
  const filters: { value: AttendanceFilter; label: string }[] = [
    { value: "ALL", label: `All ${rows.length}` },
    { value: "IN", label: `Checked in ${counts.PRESENT + counts.LATE}` },
    { value: "EXCUSED", label: `Excused ${counts.EXCUSED}` },
    { value: "ABSENT", label: `Absent ${counts.ABSENT}` },
    { value: "UNRECORDED", label: `Not marked ${counts.UNRECORDED}` },
  ];

  /*
    One layout for every row (Paul 2026-11-19: "really bad layout for
    attendance taking … no consistency with the way buttons are laid out"):
    the name on the left, and the same four answers on the right as one
    segmented control, the held one lit, so taking attendance is one click
    per member and the answer is never in two places (a badge and a menu).
    Roll call in school attendance apps, and GreekTrack's event roster, set
    it out the same way. The counts are the filter, as GitHub's and Linear's
    tab counts are, and the one bulk action sits under the list it acts on.
  */
  return (
    <section aria-label="Attendance" className="grid gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">Attendance</h3>
        <span className="text-caption text-muted-foreground">
          {counts.PRESENT + counts.LATE} of {rows.length} checked in
        </span>
      </div>
      {/* Not gated: filtering is a read, and §5 gates writes only. */}
      <SegmentedChoice
        label="Filter attendance by status"
        options={filters}
        value={statusFilter}
        onChange={setStatusFilter}
        dense
        fill
      />
      {rows.length >= ATTENDANCE_SEARCH_FROM ? (
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Find a member"
            aria-label="Find a member"
            className="pl-8"
          />
        </div>
      ) : null}
      {/*
        Disable, don't hide (§5 rule 4): the roster, the counts, and the
        filter keep working for a lapsed chapter; only recording attendance
        stops, and this says why. Silent offline on purpose: it explains
        another control, and there is nothing here to act on.
      */}
      <Can permission="events:update" offlineFallback={null}>
        <SubscriptionNotice gate={gate} feature="managing events" />
      </Can>
      {filteredRows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {needle ? "No member matches that." : "No members here."}
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {filteredRows.map((row) => {
            const checkedIn =
              row.status === "PRESENT" || row.status === "LATE"
                ? checkInLabel(row.checkInTime, eventStart)
                : null;
            const note =
              checkedIn ??
              (row.status === "EXCUSED" && row.excuseReason
                ? row.excuseReason
                : null);
            return (
              <li
                key={row.userId}
                className="flex min-h-12 flex-wrap items-center justify-between gap-x-3 gap-y-1 py-1.5"
              >
                <div className="min-w-0 flex-1">
                  <p
                    className="truncate text-sm font-semibold"
                    title={row.email || undefined}
                  >
                    {row.displayName}
                  </p>
                  {note ? (
                    <p className="truncate text-caption text-muted-foreground">
                      {note}
                    </p>
                  ) : null}
                </div>
                <Can
                  permission="events:update"
                  deniedFallback={
                    <Badge variant={attendanceStatusKind(row.status)}>
                      {attendanceStatusLabel(row.status)}
                    </Badge>
                  }
                >
                  {/*
                    The per-row write hits the same guard as the bulk action,
                    so it is gated too, on each answer rather than hidden.
                  */}
                  <SegmentedChoice
                    label={`Attendance for ${row.displayName}`}
                    options={STATUS_OPTIONS}
                    value={row.status}
                    disabled={rowGate.disabled}
                    describedBy={rowGate["aria-describedby"]}
                    dense
                    onChange={(next) => {
                      if (next === "UNRECORDED") return;
                      void changeStatus(row.userId, next);
                    }}
                  />
                </Can>
              </li>
            );
          })}
        </ul>
      )}
      <Can permission="events:update">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-3">
          <Button
            variant="secondary"
            size="sm"
            {...autoAbsentControlProps}
            onClick={runAutoAbsent}
          >
            {autoAbsent.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <UserX className="h-4 w-4" aria-hidden="true" />
            )}
            Mark no-shows absent
          </Button>
          <p
            id={waitingNoticeId}
            className="min-w-0 flex-1 text-caption text-muted-foreground"
          >
            {waitingForClose
              ? `Members this event requires who don't check in and aren't excused. Available when check-in closes (${formatRelativeDayTime(closesAt, new Date(now))}).`
              : "Members this event requires who didn't check in and aren't excused."}
          </p>
        </div>
      </Can>
    </section>
  );
}
