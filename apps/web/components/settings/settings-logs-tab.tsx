"use client";

import { useMemo, useState } from "react";
import {
  CHAPTER_LOG_ANY,
  CHAPTER_LOG_NO_FILTERS,
  chapterLogFilterRows,
  chapterLogRow,
  groupChapterLogRows,
  useChapterLogs,
  useChapterRoster,
  useMemberDisplayNames,
  type ChapterLogFilters,
  type ChapterLogRow,
} from "@repo/hooks";
import { CHAPTER_LOGS_COPY } from "@repo/validation";
import { PageActions } from "@/components/layout/page-actions";
import {
  ActiveFilterChips,
  FilterMenu,
  type FilterMenuFilter,
} from "@/components/shared/filter-menu";
import { ErrorState } from "@/components/shared/async-states";
import { SkeletonRows } from "@/components/shared/page-skeletons";
import { SectionLabel } from "@/components/shared/section-label";
import { denseListClassName } from "@/components/shared/table-controls";
import { Button } from "@/components/ui/button";

/**
 * Settings › Logs (Paul, 2026-11-21): the chapter's record of officer
 * changes, newest first, under day headings. It replaced the `#chapter-audit`
 * channel, which held a copy of the same rows in chat where every member saw
 * it first in their channel list. Officers who can view chapter settings and
 * the member list read it; the President also sees exec-only entries.
 *
 * Filtered the one way a list filters on web (rulebook § 9): the Filter menu
 * in the page header with Kind, Person and When, and the filters that are on
 * as chips under it. The phone's Logs screen offers the same rows in the same
 * order (`chapterLogFilterRows`). GitHub's audit log and Linear's workspace
 * audit log read this way: one line per change, who first, filterable by
 * actor, action and date. `spec/behavior/settings/README.md` § Logs.
 */
export function SettingsLogsTab() {
  const [filters, setFilters] = useState<ChapterLogFilters>(
    CHAPTER_LOG_NO_FILTERS,
  );
  const logs = useChapterLogs(filters);
  const roster = useChapterRoster();
  const { nameFor } = useMemberDisplayNames();

  const menuFilters: FilterMenuFilter[] = useMemo(
    () =>
      chapterLogFilterRows(roster.data ?? []).map((row) => ({
        key: row.key,
        label: row.label,
        options: row.options,
        value: filters[row.key],
        anyValue: CHAPTER_LOG_ANY,
        onChange: (value: string) =>
          setFilters((current) => ({ ...current, [row.key]: value })),
      })),
    [roster.data, filters],
  );

  const groups = useMemo(() => {
    const entries = logs.data?.pages.flat() ?? [];
    return groupChapterLogRows(
      entries.map((entry) => chapterLogRow(entry, nameFor)),
    );
  }, [logs.data, nameFor]);

  const filtered = Object.values(filters).some((v) => v !== CHAPTER_LOG_ANY);

  let body: React.ReactNode;
  if (logs.isPending) {
    body = (
      <SkeletonRows
        rows={8}
        lines={2}
        trailing={["w-14"]}
        trailingHeight="h-3"
      />
    );
  } else if (logs.isError) {
    body = (
      <ErrorState
        title={CHAPTER_LOGS_COPY.loadError}
        description="Check your connection and try again."
        onRetry={() => void logs.refetch()}
      />
    );
  } else if (groups.length === 0) {
    body = (
      <p className="py-3 text-sm text-muted-foreground">
        {filtered ? CHAPTER_LOGS_COPY.filteredEmpty : CHAPTER_LOGS_COPY.empty}
      </p>
    );
  } else {
    body = (
      <div className="space-y-6">
        {groups.map((group, index) => (
          <section
            key={group.day}
            aria-labelledby={`settings-logs-day-${index}`}
            className="space-y-2"
          >
            <SectionLabel id={`settings-logs-day-${index}`}>
              {group.day}
            </SectionLabel>
            <ul className={denseListClassName}>
              {group.rows.map((row) => (
                <LogRow key={row.id} row={row} />
              ))}
            </ul>
          </section>
        ))}
        {logs.hasNextPage ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={logs.isFetchingNextPage}
            onClick={() => void logs.fetchNextPage()}
          >
            {CHAPTER_LOGS_COPY.more}
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageActions>
        <FilterMenu filters={menuFilters} thing="logs" />
      </PageActions>
      <ActiveFilterChips filters={menuFilters} />
      {body}
    </div>
  );
}

/**
 * One change on one line: who in the foreground, what they did and to what,
 * the time at the end; the fields it changed in a muted line under it.
 */
function LogRow({ row }: { row: ChapterLogRow }) {
  return (
    <li className="flex min-h-11 items-start gap-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="text-sm text-muted-foreground">
          {row.actor ? (
            <span className="font-semibold text-foreground">{row.actor} </span>
          ) : null}
          {row.phrase}
          {row.subject ? (
            <span className="text-foreground"> {row.subject}</span>
          ) : null}
        </p>
        {row.changes.length > 0 ? (
          <p className="mt-0.5 truncate text-caption text-muted-foreground">
            {row.changes.join(" · ")}
          </p>
        ) : null}
      </div>
      <time
        dateTime={row.createdAt}
        className="shrink-0 pt-0.5 text-caption text-muted-foreground"
      >
        {row.time}
      </time>
    </li>
  );
}
