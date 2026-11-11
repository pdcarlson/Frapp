"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { describeLoadFailure } from "@repo/hooks/error-copy";
import { useQueryClient } from "@tanstack/react-query";
import {
  ErrorState,
  OfflineState,
  anyReadUncached,
} from "@/components/shared/async-states";
import { FILTER_CHIP_CLASS } from "@/components/shared/filter-chip";
import { InlineNote } from "@/components/shared/inline-note";
import { SectionLabel } from "@/components/shared/section-label";
import { denseListClassName } from "@/components/shared/table-controls";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FOCUS_RING } from "@/components/ui/focus";
import { useFrappUser } from "@/lib/auth/use-frapp-user";
import { useNetwork } from "@/lib/providers/network-provider";
import { cn } from "@/lib/utils";
import { ActivityPanel } from "./activity-panel";
import {
  ACTIVITY_FILTERS,
  ACTIVITY_SECTION_NAMES,
  activityGroups,
  activityKeys,
  useActiveChapterId,
  useActivity,
  type ActivityFilter,
  type ActivityGroup,
  type ActivityRow,
} from "@repo/hooks";
import { ActivityPageSkeleton } from "./activity-skeleton";

/** Where a file row goes: the page the file lives on. */
function fileHref(row: Extract<ActivityRow, { kind: "file" }>): string {
  return row.file.source === "document" ? "/documents" : "/backwork";
}

/** The row's two lines and its badge, shared by the button and the link form. */
function RowContent({ row }: { row: ActivityRow }) {
  return (
    <>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-foreground">
          {row.title}
        </span>
        {row.detail ? (
          <span className="block truncate text-caption text-muted-foreground">
            {row.detail}
          </span>
        ) : null}
      </span>
      {row.badge ? (
        <Badge variant={row.badge.variant} className="shrink-0">
          {row.badge.label}
        </Badge>
      ) : null}
      <ChevronRight
        className="h-4 w-4 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
    </>
  );
}

/** A row is one hit target: the whole line opens the record. */
const ROW_CLASS = cn(
  "flex min-h-14 w-full items-center gap-3 rounded-md px-2 py-2 text-left",
  "transition-colors hover:bg-surface-1",
  FOCUS_RING,
);

function GroupSection({
  group,
  filtered,
  onOpen,
}: {
  group: ActivityGroup;
  filtered: boolean;
  onOpen: (row: ActivityRow) => void;
}) {
  const labelId = `activity-${group.id}`;
  return (
    <section aria-labelledby={labelId} className="space-y-3">
      <SectionLabel id={labelId} count={group.rows.length || null}>
        {group.label}
      </SectionLabel>
      {group.unavailable.length > 0 ? (
        // A section the read could not load is said, never shown as empty:
        // "nothing is waiting on you" must not be a failed read.
        <InlineNote className="text-warning">
          Couldn&apos;t load{" "}
          {group.unavailable
            .map((section) => ACTIVITY_SECTION_NAMES[section])
            .join(", ")}
          . Try again in a moment.
        </InlineNote>
      ) : null}
      {group.rows.length === 0 ? (
        group.unavailable.length === 0 ? (
          <InlineNote>
            {filtered ? "Nothing of this kind here." : group.empty}
          </InlineNote>
        ) : null
      ) : (
        <ul className={denseListClassName}>
          {group.rows.map((row) => (
            <li key={row.key}>
              {row.kind === "file" ? (
                <Link href={fileHref(row)} className={ROW_CLASS}>
                  <RowContent row={row} />
                </Link>
              ) : (
                <button
                  type="button"
                  className={ROW_CLASS}
                  onClick={() => onOpen(row)}
                >
                  <RowContent row={row} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * `/activity`: what is waiting on the member and what they made, in one place
 * (#3897, `spec/behavior/activity.md`). An inbox beside chat, not a home.
 *
 * Three groups, "Needs you" first, with chips that narrow every group to one
 * kind of thing. A row opens the record in a panel drawn with chat's own card,
 * where the member acts on it; a file row is a link to the page the file
 * lives on. When the read refreshes after an action, the panel shows the fresh
 * row; a row that has left the list (a vote cast, a completion confirmed)
 * stays open as it was, so the member sees the result of what they just did
 * rather than having the panel vanish under them.
 */
export function ActivityPage() {
  const activity = useActivity();
  const { isOffline } = useNetwork();
  const { userId } = useFrappUser();
  const chapterId = useActiveChapterId();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const [opened, setOpened] = useState<ActivityRow | null>(null);

  const groups = useMemo(
    () => (activity.data ? activityGroups(activity.data, filter) : []),
    [activity.data, filter],
  );
  const openRow = useMemo(
    () =>
      opened === null
        ? null
        : (groups
            .flatMap((group) => group.rows)
            .find((row) => row.key === opened.key) ?? opened),
    [groups, opened],
  );

  if (isOffline && anyReadUncached(activity)) {
    return (
      <OfflineState
        title="Activity unavailable offline"
        description="Reconnect to see what's waiting on you."
        onRetry={() => void activity.refetch()}
      />
    );
  }
  if (activity.isPending) return <ActivityPageSkeleton />;
  // Only with nothing to show: a refetch that fails (this page refetches after
  // every action) keeps the list it already has rather than replacing it, and
  // the open panel with it, by an error page. The same guard as the task board.
  if (activity.isError && !activity.data) {
    return (
      <ErrorState
        title="Couldn't load your activity"
        description={describeLoadFailure(activity.error)}
        onRetry={() => void activity.refetch()}
      />
    );
  }

  const refresh = () => {
    if (!chapterId) return;
    void queryClient.invalidateQueries({
      queryKey: activityKeys.chapter(chapterId),
      exact: true,
    });
  };

  return (
    <div className="space-y-8">
      <div
        role="group"
        aria-label="Show"
        className="flex flex-wrap items-center gap-2"
      >
        {ACTIVITY_FILTERS.map((option) => (
          <Button
            key={option.value}
            type="button"
            size="toolbar"
            variant={filter === option.value ? "tinted" : "secondary"}
            className={FILTER_CHIP_CLASS}
            aria-pressed={filter === option.value}
            onClick={() => setFilter(option.value)}
          >
            {option.label}
          </Button>
        ))}
      </div>

      {groups.map((group) =>
        // Under a chip, a group with nothing of that kind is left out rather
        // than drawn as three "nothing here" lines; "Needs you" always stays.
        filter !== "all" &&
        group.id !== "needs-you" &&
        group.rows.length === 0 &&
        group.unavailable.length === 0 ? null : (
          <GroupSection
            key={group.id}
            group={group}
            filtered={filter !== "all"}
            onOpen={setOpened}
          />
        ),
      )}

      <ActivityPanel
        row={openRow}
        viewerId={userId}
        onClose={(key) => {
          // A late answer from one row's action must not close another row
          // the member has since opened.
          setOpened((current) =>
            key === undefined || current?.key === key ? null : current,
          );
          // The cards write through their own hooks (a task's status, a
          // check-in), which this page's read does not hear about, so it is
          // re-read when the panel closes by hand. An action's own close
          // (`key` given) has already re-read through `onActed`.
          if (key === undefined) refresh();
        }}
        onActed={refresh}
      />
    </div>
  );
}
