"use client";

import { useMemo, useState } from "react";
import { describeLoadFailure } from "@repo/hooks/error-copy";
import { memberFallbackLabel } from "@repo/hooks/display-names";
import {
  formatServiceHours,
  serviceSemesterStartDate,
  useSemesters,
  useServiceLeaderboard,
  type SemesterArchive,
} from "@repo/hooks";
import { Badge } from "@/components/ui/badge";
import { SegmentedChoice } from "@/components/ui/segmented";
import { InlineNote, InlineNoteAction } from "@/components/shared/inline-note";
import { NestedError, NestedOffline } from "@/components/shared/nested-states";
import { SkeletonRows } from "@/components/shared/page-skeletons";
import { SectionLabel } from "@/components/shared/section-label";
import { denseListClassName } from "@/components/shared/table-controls";
import { useNetwork } from "@/lib/providers/network-provider";
import { cn } from "@/lib/utils";
import {
  rankServiceLeaderboard,
  visibleLeaderboard,
  type RankedServiceRow,
} from "@/components/service/service-summary";

export type LeaderboardWindow = "semester" | "all";

const WINDOWS = [
  { value: "semester", label: "This semester" },
  { value: "all", label: "All time" },
] as const satisfies readonly { value: LeaderboardWindow; label: string }[];

/**
 * The first day of this semester for the service reads, from the chapter's
 * semester archives (`GET /v1/semesters`, `members:view`): a `YYYY-MM-DD`,
 * `null` for a chapter that never rolled over (this semester is all time),
 * or `undefined` while the archives are unread or failed.
 */
export function useServiceSemesterStart(): {
  start: string | null | undefined;
  isError: boolean;
  refetch: () => void;
} {
  const semesters = useSemesters();
  const start = useMemo(() => {
    if (!Array.isArray(semesters.data)) return undefined;
    return serviceSemesterStartDate(semesters.data as SemesterArchive[]);
  }, [semesters.data]);
  return {
    start,
    isError: semesters.isError,
    refetch: () => void semesters.refetch(),
  };
}

/**
 * The chapter's service leaderboard on `/service` (#4669, Shawn): everyone's
 * APPROVED hours, ranked, from `GET /v1/service-entries/leaderboard`, with a
 * This semester / All time switch over its date filter. The viewer's own row
 * is marked "You", and when they sit below the first ten it is pinned under
 * them after a gap, as Strava's club leaderboard keeps your row in view and
 * Duolingo's league list highlights it.
 *
 * Rendered only for a `members:view` holder, which the route requires. Who is
 * on it is the endpoint's call: it ranks everyone with approved time in the
 * window, members who have since left included (#811, #543 hold whether they
 * should stay).
 */
export function ServiceLeaderboard({
  viewerUserId,
  nameFor,
  semesterStart,
  semesterUnreadable,
  retrySemester,
}: {
  viewerUserId: string | null;
  /** The roster's name for a member, or `undefined` when it holds none. */
  nameFor: (userId: string) => string | undefined;
  semesterStart: string | null | undefined;
  semesterUnreadable: boolean;
  retrySemester: () => void;
}) {
  const { isOffline } = useNetwork();
  const [period, setPeriod] = useState<LeaderboardWindow>("semester");
  const [expanded, setExpanded] = useState(false);
  // This semester waits for its start day; a chapter that never rolled over
  // (`null`) reads the same board as All time, with no bound.
  const range =
    period === "semester" && semesterStart ? { start_date: semesterStart } : {};
  const waitingOnSemester =
    period === "semester" && semesterStart === undefined;
  const query = useServiceLeaderboard(range, { enabled: !waitingOnSemester });

  const ranked = useMemo(
    () => rankServiceLeaderboard(query.data ?? [], viewerUserId),
    [query.data, viewerUserId],
  );
  const { top, pinned } = visibleLeaderboard(ranked, expanded);
  const viewerOnBoard = ranked.some((row) => row.isViewer);

  function body() {
    if (waitingOnSemester && semesterUnreadable) {
      return (
        <NestedError
          title="Couldn't find this semester"
          description="The semester's start date didn't load, so this board can't be counted yet. All time still works."
          onRetry={retrySemester}
        />
      );
    }
    if (isOffline && query.data === undefined) {
      return (
        <NestedOffline
          title="Leaderboard unavailable offline"
          description="Reconnect to see the chapter's service hours."
          onRetry={() => void query.refetch()}
        />
      );
    }
    if (waitingOnSemester || query.isPending) {
      return (
        <div role="status" aria-label="Loading the leaderboard">
          <SkeletonRows rows={5} lines={1} trailing={["w-12"]} />
        </div>
      );
    }
    if (query.isError) {
      return (
        <NestedError
          title="Couldn't load the leaderboard"
          description={describeLoadFailure(query.error)}
          onRetry={() => void query.refetch()}
        />
      );
    }
    if (ranked.length === 0) {
      return (
        <InlineNote>
          {period === "semester"
            ? "No approved hours this semester yet."
            : "No approved hours yet."}
        </InlineNote>
      );
    }
    return (
      <>
        {/* `role="list"` restated: a flex `<li>` loses its `list-item` box,
            and WebKit then stops exposing the list and its item count. */}
        <ul role="list" className={denseListClassName}>
          {top.map((row) => (
            <LeaderboardRow key={row.user_id} row={row} nameFor={nameFor} />
          ))}
        </ul>
        {pinned ? (
          <>
            <p
              aria-hidden="true"
              className="text-center text-caption text-muted"
            >
              ···
            </p>
            <ul
              role="list"
              aria-label="Your place"
              className={denseListClassName}
            >
              <LeaderboardRow row={pinned} nameFor={nameFor} />
            </ul>
          </>
        ) : null}
        {ranked.length > top.length || expanded ? (
          <InlineNote>
            <InlineNoteAction onClick={() => setExpanded((open) => !open)}>
              {expanded ? "Show top 10" : `Show all ${ranked.length}`}
            </InlineNoteAction>
          </InlineNote>
        ) : null}
        {viewerUserId !== null && !viewerOnBoard ? (
          <InlineNote>
            {period === "semester"
              ? "You're not on the board yet this semester. Approved hours put you on it."
              : "You're not on the board yet. Approved hours put you on it."}
          </InlineNote>
        ) : null}
      </>
    );
  }

  return (
    <section aria-labelledby="svc-board-label" className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <SectionLabel
          id="svc-board-label"
          count={
            !query.isPending && !query.isError && ranked.length > 0
              ? `${ranked.length} member${ranked.length === 1 ? "" : "s"}`
              : null
          }
        >
          Leaderboard
        </SectionLabel>
        <SegmentedChoice
          label="Leaderboard period"
          options={WINDOWS}
          value={period}
          onChange={(next) => {
            setPeriod(next);
            setExpanded(false);
          }}
          dense
        />
      </div>
      {body()}
    </section>
  );
}

function LeaderboardRow({
  row,
  nameFor,
}: {
  row: RankedServiceRow;
  nameFor: (userId: string) => string | undefined;
}) {
  // The roster's name first, as every other surface names a member; the
  // board's own `member_name` for someone the roster no longer holds, then
  // the shared fallback, never a raw id.
  const name =
    nameFor(row.user_id) ||
    row.member_name.trim() ||
    memberFallbackLabel(row.user_id);
  return (
    <li
      className={cn(
        "flex min-h-11 items-center gap-3",
        // Every row is inset by the same 8px, so the viewer's row can take
        // the accent's subtle tint (the segmented control's held answer) as
        // a band without its text shifting or its edge leaving the list.
        "px-2",
        row.isViewer && "rounded-sm bg-accent-subtle",
      )}
    >
      <span className="w-10 shrink-0 font-mono text-caption tabular-nums text-muted-foreground">
        {`#${row.rank}`}
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <span
          className={cn(
            "truncate text-sm",
            row.isViewer ? "font-semibold text-foreground" : "text-foreground",
          )}
        >
          {name}
        </span>
        {row.isViewer ? <Badge variant="outline">You</Badge> : null}
      </span>
      <span className="shrink-0 text-right font-mono text-sm font-semibold tabular-nums text-foreground">
        {formatServiceHours(row.total_minutes)}
        {/* The unit in the sans caption, so mono spaces only the number. */}
        <span className="font-sans text-caption font-normal text-muted-foreground">
          {" "}
          h
        </span>
        <span className="sr-only"> approved</span>
      </span>
    </li>
  );
}
