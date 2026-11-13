import { Skeleton } from "@/components/shared/async-states";
import {
  PageSkeleton,
  SkeletonSectionLabel,
} from "@/components/shared/page-skeletons";
import { denseListClassName } from "@/components/shared/table-controls";
import { SemesterStripSkeleton } from "./semester-strip";
import { WeekCardSkeleton } from "./week-card";

/**
 * `/activity` while it loads, in the loaded page's own frames (#4766): the
 * week card, This semester's gauges, then To do as a label over two-line
 * rows with a badge at the end.
 */
export function ActivityPageSkeleton() {
  return (
    <PageSkeleton label="Loading your activity" className="@container">
      <div className="space-y-8">
        <WeekCardSkeleton />
        <SemesterStripSkeleton />
        <section className="space-y-3">
          <SkeletonSectionLabel width="w-16" count />
          <ul className={denseListClassName}>
            {Array.from({ length: 4 }, (_, row) => (
              <li
                key={row}
                className="flex min-h-14 items-center justify-between gap-3 px-2 py-2"
              >
                <Skeleton className="h-10 w-10 shrink-0 rounded-sm" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-[13px] w-[55%]" />
                  <Skeleton className="h-[11px] w-[35%]" />
                </div>
                <Skeleton className="h-6 w-16 rounded-md" />
              </li>
            ))}
          </ul>
        </section>
      </div>
    </PageSkeleton>
  );
}
