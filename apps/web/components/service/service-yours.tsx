"use client";

import type { ReactNode } from "react";
import type { components } from "@repo/api-sdk";
import { awardedPointsLabel, statusLabel } from "@repo/validation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InlineNote, InlineNoteAction } from "@/components/shared/inline-note";
import { SectionLabel } from "@/components/shared/section-label";
import { denseListClassName } from "@/components/shared/table-controls";
import { serviceStatusKind } from "@/components/service/service-status";
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
 * nothing but the viewer's own.
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
}) {
  return (
    <section aria-labelledby="svc-mine-label" className="min-w-0 space-y-6">
      <div className="space-y-3">
        <SectionLabel id="svc-mine-label">Your service hours</SectionLabel>
        <dl className="grid grid-cols-[repeat(auto-fit,minmax(7.5rem,1fr))] gap-4">
          <Stat
            label="This semester"
            value={
              totals.semesterMinutes === null
                ? "–"
                : hoursLabel(totals.semesterMinutes)
            }
            detail={
              totals.semesterMinutes === null
                ? semesterUnreadable
                  ? "Couldn't load"
                  : null
                : "approved"
            }
          />
          <Stat
            label="All time"
            value={hoursLabel(totals.allTimeMinutes)}
            detail="approved"
          />
          <Stat
            label="Pending"
            value={hoursLabel(totals.pendingMinutes)}
            detail={`${totals.pendingCount} ${totals.pendingCount === 1 ? "entry" : "entries"}`}
          />
        </dl>
      </div>

      <div className="space-y-2">
        <SectionLabel
          id="svc-log-label"
          count={
            entries.length > 0
              ? `${entries.length} ${entries.length === 1 ? "entry" : "entries"}`
              : null
          }
        >
          Your log
        </SectionLabel>
        {entries.length === 0 ? (
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
            {entries.map((entry) => {
              const pointsLabel = awardedPointsLabel(entry);
              return (
                <li
                  key={entry.id}
                  className="flex min-h-11 flex-col gap-1 py-2 @2xl:flex-row @2xl:items-center @2xl:justify-between @2xl:gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{entry.description}</p>
                    <p className="text-caption text-muted-foreground">
                      {entryMeta(entry)}
                    </p>
                    {entry.review_comment ? (
                      <p className="text-caption text-muted-foreground">
                        Reviewer note: {entry.review_comment}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={serviceStatusKind(entry.status)}>
                      {statusLabel("serviceEntry", entry.status)}
                    </Badge>
                    {pointsLabel ? (
                      <Badge variant="outline">{pointsLabel}</Badge>
                    ) : null}
                    {entry.status === "PENDING" ? (
                      <Button
                        size="toolbar"
                        variant="ghost"
                        onClick={() => onWithdraw(entry)}
                        {...withdrawControlProps}
                      >
                        Withdraw
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
