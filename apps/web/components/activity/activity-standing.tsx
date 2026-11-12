import Link from "next/link";
import {
  activityStandingRows,
  type ActivityStanding as Standing,
  type StandingRow,
} from "@repo/hooks";
import { Skeleton } from "@/components/shared/async-states";
import {
  meterFillClassName,
  meterTrackDenseClassName,
} from "@/components/shared/meter";
import { SectionLabel } from "@/components/shared/section-label";
import { FOCUS_RING } from "@/components/ui/focus";
import { cn } from "@/lib/utils";

/** The page that owns each number. */
const HREF: Record<StandingRow["id"], string> = {
  points: "/points",
  required_events: "/events",
  service: "/service",
  study: "/study",
};

/**
 * "This semester" at the top of `/activity` (Evan, 2026-11-12: a dashboard
 * with "progress bars and stuff"): the member's points and place, the
 * required events they made, their service hours and this week's study time,
 * from `GET /v1/activity/standing`. The phone draws the same rows
 * (`apps/mobile/components/activity/activity-standing.tsx`); here they are
 * tiles side by side, in the recipe of the summary's tiles below them.
 *
 * A cell opens the page that owns its number. A cell draws a meter only when
 * it has a target: required events always, and points or hours when the
 * chapter sets the member a goal in Chapter settings (#1062). The meter is `components/shared/meter.ts`'s, beside
 * the count in words, and hidden from a screen reader, which hears the
 * cell's sentence instead.
 */
export function ActivityStanding({ standing }: { standing: Standing }) {
  const rows = activityStandingRows(standing);
  if (rows.length === 0) return null;
  return (
    <section aria-labelledby="activity-standing" className="space-y-2">
      <SectionLabel id="activity-standing">This semester</SectionLabel>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-2">
        {rows.map((row) => (
          <li key={row.id}>
            <Link
              href={HREF[row.id]}
              aria-label={row.spokenLabel}
              className={cn(
                "flex h-full min-h-16 flex-col justify-between gap-1 rounded-md border border-border bg-card px-3 py-2.5 transition-colors hover:bg-card-hover",
                FOCUS_RING,
              )}
            >
              <span className="text-caption font-semibold text-muted-foreground">
                {row.label}
              </span>
              <span className="flex min-w-0 items-baseline gap-2">
                <span
                  className={cn(
                    "shrink-0 tabular-nums",
                    row.value === null
                      ? "text-caption text-muted-foreground"
                      : "text-headline text-foreground",
                  )}
                >
                  {row.value ?? "–"}
                </span>
                {row.detail ? (
                  <span className="truncate text-caption tabular-nums text-muted-foreground">
                    {row.detail}
                  </span>
                ) : null}
              </span>
              {row.progress !== null ? (
                <span aria-hidden="true" className={meterTrackDenseClassName}>
                  <span
                    className={cn("block", meterFillClassName)}
                    style={{
                      width: `${Math.round(Math.min(1, Math.max(0, row.progress)) * 100)}%`,
                    }}
                  />
                </span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The section before its first read: the label over four quiet cells. */
export function ActivityStandingSkeleton() {
  return (
    <div aria-hidden="true" className="space-y-2">
      <Skeleton className="h-[12px] w-24" />
      <div className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-2">
        {[0, 1, 2, 3].map((cell) => (
          <div
            key={cell}
            className="min-h-16 space-y-2 rounded-md border border-border bg-card px-3 py-2.5"
          >
            <Skeleton className="h-[11px] w-[45%]" />
            <Skeleton className="h-[16px] w-[35%]" />
          </div>
        ))}
      </div>
    </div>
  );
}
