"use client";

import Link from "next/link";
import {
  activityStandingGauges,
  type ActivityStanding,
  type StandingRow,
} from "@repo/hooks";
import { Skeleton } from "@/components/shared/async-states";
import { ProgressRing } from "@/components/shared/progress-ring";
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

/** A gauge's ring: the week ring's recipe, small enough to lead a line. */
const GAUGE_SIZE = 36;
const GAUGE_STROKE = 5;

/**
 * How many gauges share a row on a wide page: all of them, so three are
 * thirds and not three of four. A narrow page is always two across.
 */
const WIDE_COLUMNS = [
  "",
  "@3xl:grid-cols-1",
  "@3xl:grid-cols-2",
  "@3xl:grid-cols-3",
  "@3xl:grid-cols-4",
] as const;

/**
 * "This semester" under the week card (#4766): the member's points, required
 * events, service hours and this week's study time as up to four gauges in
 * one card, from `GET /v1/activity/standing` (Evan, 2026-11-12: a dashboard
 * with "progress bars and stuff"). The phone's strip
 * (`apps/mobile/components/activity/semester-strip.tsx`) on web, from the
 * same model (`activityStandingGauges`); four tiles in the count tiles'
 * recipe stood here before. The ring says the week; this says the long run.
 *
 * Two across on a narrow page, where an odd gauge out takes the full row,
 * and one row on a wide one.
 *
 * A gauge draws a ring only when its number has a target (required events
 * always; points and hours when the chapter sets the member a goal, #1062):
 * a ring with an invented end would read as a rule. Without one the number
 * stands alone. A number that is zero with nothing to aim at is left out,
 * which is the zero tile's fix (#4679), and with none left the strip isn't
 * drawn. Each gauge opens the page that owns its number. The ring is hidden
 * from a screen reader, which hears the gauge's sentence instead.
 */
export function SemesterStrip({ standing }: { standing: ActivityStanding }) {
  const gauges = activityStandingGauges(standing);
  if (gauges.length === 0) return null;
  return (
    <section aria-labelledby="activity-standing" className="space-y-2">
      <SectionLabel id="activity-standing">This semester</SectionLabel>
      <ul className={frameClassName(gauges.length)}>
        {gauges.map((gauge) => (
          <li key={gauge.id} className={CELL}>
            <Link
              href={HREF[gauge.id]}
              aria-label={gauge.spokenLabel}
              data-testid={`activity-standing-${gauge.id}`}
              className={cn(
                "flex h-full min-h-16 items-center gap-2.5 px-3 py-3 transition-colors hover:bg-card-hover @md:gap-3 @md:px-4",
                // Inset: the frame clips an outer ring at its rounded edge.
                FOCUS_RING,
                "focus-visible:ring-inset",
              )}
            >
              {gauge.progress !== null ? (
                <ProgressRing
                  size={GAUGE_SIZE}
                  stroke={GAUGE_STROKE}
                  progress={gauge.progress}
                  tone={gauge.progress >= 1 ? "success" : "accent"}
                  data-testid={`activity-gauge-ring-${gauge.id}`}
                />
              ) : null}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-caption tabular-nums text-muted-foreground">
                  <span
                    className={cn(
                      "text-label",
                      gauge.figure === null
                        ? "text-muted-foreground"
                        : "text-foreground",
                    )}
                  >
                    {gauge.figure ?? "–"}
                  </span>
                  {gauge.target ? ` ${gauge.target}` : null}
                </span>
                <span className="block truncate text-caption text-foreground">
                  {/* One word while two across, as on the phone: "Required
                      events · 1 excused" doesn't fit half a pane. */}
                  <span className="@3xl:hidden">{gauge.shortLabel}</span>
                  <span className="hidden @3xl:inline">{gauge.label}</span>
                  {gauge.detail ? (
                    <span className="tabular-nums text-muted-foreground">
                      {" · "}
                      {gauge.detail}
                    </span>
                  ) : null}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The card as a grid whose 1px gaps show the border colour through, so the
 * gauges are ruled apart however they wrap.
 */
function frameClassName(count: number): string {
  return cn(
    "grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border",
    WIDE_COLUMNS[Math.min(count, 4)],
  );
}

/** A cell: the last of an odd count takes the full row while two across. */
const CELL = "bg-card @max-3xl:last:odd:col-span-2";

/** The strip before its first read: the label over four quiet gauges. */
export function SemesterStripSkeleton() {
  return (
    <div aria-hidden="true" className="space-y-2">
      <Skeleton className="h-[12px] w-24" />
      <div className={frameClassName(4)}>
        {[0, 1, 2, 3].map((cell) => (
          <div
            key={cell}
            className={cn(
              CELL,
              "flex min-h-16 items-center gap-2.5 px-3 py-3 @md:gap-3 @md:px-4",
            )}
          >
            <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-[13px] w-[55%]" />
              <Skeleton className="h-[11px] w-[70%]" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
