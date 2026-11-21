"use client";

import type { ReactNode } from "react";
import type { components } from "@repo/api-sdk";
import { Button } from "@/components/ui/button";
import { InlineNote, InlineNoteAction } from "@/components/shared/inline-note";
import { NestedError } from "@/components/shared/nested-states";
import { SkeletonRows } from "@/components/shared/page-skeletons";
import { SectionLabel } from "@/components/shared/section-label";
import { denseListClassName } from "@/components/shared/table-controls";
import { ServiceEntryRow } from "@/components/service/service-entry-row";
import {
  hoursLabel,
  type OwnServiceTotals,
} from "@/components/service/service-summary";

type ServiceEntry = components["schemas"]["ServiceEntryResponseDto"];

/** A stat on the page surface, the `/points` balance recipe: label over number, no frame. */
function Stat({
  label,
  value,
  detail,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-0.5">
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        <span className="text-headline font-bold tabular-nums text-foreground">
          {value}
        </span>
        {detail ? (
          <span className="text-caption tabular-nums text-muted-foreground">
            {detail}
          </span>
        ) : null}
      </dd>
    </div>
  );
}

/**
 * The top of `/service` (#4669, Shawn): the viewer's own approved hours this
 * semester and all time with what is pending beside them, then their own log
 * of every entry in every state, newest first. It is the viewer's alone
 * whatever their role: an approver's chapter-wide read is filtered to them
 * before it reaches here, and their review queue and the chapter's history
 * sit below this section.
 *
 * Withdraw stays on a pending row, and only here: `DELETE
 * /v1/service-entries/:id` lets a `service:approve` holder delete anyone's
 * pending entry and its proof, so the control lives on a list that holds
 * nothing but the viewer's own. `notice` replaces it with a sentence when the
 * list is the viewer's only because the server pinned it (their own id didn't
 * load), so nothing here can be deleted by id.
 *
 * `state` is the viewer's own read: a skeleton while it loads, an error with a
 * retry when it fails. The stats wait with the rows, so they never read 0 h
 * before the entries arrive.
 */
export function ServiceYours({
  entries,
  totals,
  semesterUnreadable,
  entryMeta,
  canLog,
  onLogFirst,
  logControlProps,
  withdrawControlProps,
  onWithdraw,
  state = "ready",
  onRetry,
  errorDescription,
  notice,
}: {
  /** The viewer's own entries, newest first. */
  entries: readonly ServiceEntry[];
  totals: OwnServiceTotals;
  semesterUnreadable: boolean;
  entryMeta: (entry: ServiceEntry) => string;
  canLog: boolean;
  onLogFirst: () => void;
  logControlProps: Record<string, unknown>;
  withdrawControlProps: Record<string, unknown>;
  onWithdraw: (entry: ServiceEntry) => void;
  state?: "loading" | "error" | "ready";
  onRetry?: () => void;
  /** The load-failure line (`describeLoadFailure`) for the error state. */
  errorDescription?: string;
  /** Said under the label instead of offering Withdraw; see above. */
  notice?: string;
}) {
  const ready = state === "ready";
  return (
    <section aria-labelledby="svc-mine-label" className="min-w-0 space-y-6">
      <div className="space-y-3">
        <SectionLabel id="svc-mine-label">Your service hours</SectionLabel>
        {notice ? (
          <p className="text-sm text-muted-foreground">{notice}</p>
        ) : null}
        <dl className="grid grid-cols-[repeat(auto-fit,minmax(7.5rem,1fr))] gap-4">
          <Stat
            label="This semester"
            value={
              !ready || totals.semesterMinutes === null
                ? "–"
                : hoursLabel(totals.semesterMinutes)
            }
            detail={
              !ready
                ? null
                : totals.semesterMinutes === null
                  ? semesterUnreadable
                    ? "Couldn't load"
                    : null
                  : "approved"
            }
          />
          <Stat
            label="All time"
            value={ready ? hoursLabel(totals.allTimeMinutes) : "–"}
            detail={ready ? "approved" : null}
          />
          <Stat
            label="Pending"
            value={ready ? hoursLabel(totals.pendingMinutes) : "–"}
            detail={
              ready
                ? `${totals.pendingCount} ${totals.pendingCount === 1 ? "entry" : "entries"}`
                : null
            }
          />
        </dl>
      </div>

      <div className="space-y-2">
        <SectionLabel
          id="svc-log-label"
          count={
            ready && entries.length > 0
              ? `${entries.length} ${entries.length === 1 ? "entry" : "entries"}`
              : null
          }
        >
          Your log
        </SectionLabel>
        {state === "loading" ? (
          <div role="status" aria-label="Loading your service log">
            <SkeletonRows
              rows={3}
              lines={2}
              trailing={["w-20", "w-16"]}
              trailingHeight="h-6"
            />
          </div>
        ) : state === "error" ? (
          <NestedError
            title="Couldn't load your service hours"
            description={errorDescription ?? ""}
            onRetry={onRetry}
          />
        ) : entries.length === 0 ? (
          // One line where the rows go (empty-states plan rule 7); the first
          // entry starts from the line, through the toolbar's gated dialog.
          <InlineNote>
            You haven&apos;t logged any service yet.
            {canLog ? (
              <>
                {" "}
                <InlineNoteAction onClick={onLogFirst} {...logControlProps}>
                  Log your first hours
                </InlineNoteAction>
              </>
            ) : null}
          </InlineNote>
        ) : (
          <ul
            role="list"
            aria-labelledby="svc-log-label"
            className={denseListClassName}
          >
            {entries.map((entry) => (
              <ServiceEntryRow
                key={entry.id}
                entry={entry}
                title={entry.description}
                meta={entryMeta(entry)}
                action={
                  entry.status === "PENDING" && !notice ? (
                    <Button
                      size="toolbar"
                      variant="ghost"
                      onClick={() => onWithdraw(entry)}
                      {...withdrawControlProps}
                    >
                      Withdraw
                    </Button>
                  ) : null
                }
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
