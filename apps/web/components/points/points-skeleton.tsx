import { Skeleton } from "@/components/shared/async-states";
import {
  PageSkeleton,
  SkeletonControl,
  SkeletonRows,
  SkeletonSectionLabel,
} from "@/components/shared/page-skeletons";
import { stateMicrocopy } from "@/lib/state-microcopy";

/**
 * `/points` while it loads: the period toggle and Adjust points, the balance,
 * then the leaderboard beside My transactions on the page's 0.9/1.1 grid.
 */
export function PointsPageSkeleton() {
  return (
    <PageSkeleton
      label={stateMicrocopy.points.loading}
      actions={
        <>
          <SkeletonControl className="w-[208px]" />
          <SkeletonControl className="w-[124px]" />
        </>
      }
    >
      <div className="space-y-2">
        <Skeleton className="h-[11px] w-16" />
        <Skeleton className="h-7 w-24" />
      </div>
      <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr]">
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="mr-auto">
              <SkeletonSectionLabel width="w-24" count />
            </div>
            <SkeletonControl className="w-full sm:w-56" />
          </div>
          <SkeletonRows
            rows={10}
            lines={1}
            lead="rank"
            trailing={["w-6"]}
            trailingHeight="h-[13px]"
          />
        </section>
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="mr-auto">
              <SkeletonSectionLabel width="w-28" count />
            </div>
            <SkeletonControl className="w-full sm:w-48" />
            <SkeletonControl className="w-[124px]" />
            <SkeletonControl className="w-[132px]" />
          </div>
          <div className="flex h-6 items-center gap-2">
            <Skeleton className="h-6 w-6 rounded-[7px]" />
            <Skeleton className="h-[11px] w-16" />
          </div>
          <SkeletonRows
            rows={5}
            lead="checkbox"
            trailing={["w-8"]}
            trailingHeight="h-[13px]"
            rowClassName="min-h-11 py-1.5"
          />
        </section>
      </div>
    </PageSkeleton>
  );
}
