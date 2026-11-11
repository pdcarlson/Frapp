import {
  PageSkeleton,
  SkeletonRows,
  SkeletonSectionLabel,
} from "@/components/shared/page-skeletons";
import { Skeleton } from "@/components/shared/async-states";

/**
 * `/study` while it loads: Start a session (zone select and Start button on
 * one row, then its caption), then Session history's rows with their badges.
 */
export function StudyPageSkeleton() {
  return (
    <PageSkeleton label="Loading study hours" className="@container space-y-6">
      <section className="space-y-3">
        <SkeletonSectionLabel width="w-28" />
        <div className="grid gap-3 @md:grid-cols-[minmax(0,20rem)_auto] @md:items-end">
          <div className="grid gap-2">
            <Skeleton className="h-[11px] w-20" />
            <Skeleton className="h-11 w-full rounded-md" />
          </div>
          <Skeleton className="h-11 w-[140px] rounded-md" />
        </div>
        <Skeleton className="h-[11px] w-[260px]" />
      </section>
      <section className="space-y-3">
        <SkeletonSectionLabel width="w-28" count />
        <SkeletonRows
          rows={3}
          trailing={["w-20", "w-24"]}
          trailingHeight="h-6"
        />
      </section>
    </PageSkeleton>
  );
}
