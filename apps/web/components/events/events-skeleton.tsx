import { Skeleton } from "@/components/shared/async-states";
import {
  PageSkeleton,
  SkeletonControl,
  SkeletonRows,
  SkeletonSectionLabel,
} from "@/components/shared/page-skeletons";
import { stateMicrocopy } from "@/lib/state-microcopy";

/**
 * `/events` while it loads: the one toolbar row (search, three filters, the
 * List/Calendar toggle, New event), then the list view's select-all header and
 * its checkbox rows.
 */
export function EventsPageSkeleton() {
  return (
    <PageSkeleton
      label={stateMicrocopy.events.loading}
      className="space-y-4"
      actions={
        <>
          <SkeletonControl className="w-full sm:w-56" />
          <SkeletonControl className="w-[132px]" />
          <SkeletonControl className="w-[148px]" />
          <SkeletonControl className="w-[124px]" />
          <Skeleton className="h-[13px] w-[96px]" />
          <SkeletonControl className="w-[112px]" />
        </>
      }
    >
      <div className="space-y-2">
        <div className="flex min-h-9 items-center gap-3">
          <Skeleton className="h-6 w-6 rounded-[7px]" />
          <SkeletonSectionLabel width="w-20" count />
        </div>
        <SkeletonRows rows={7} lead="checkbox" />
      </div>
    </PageSkeleton>
  );
}
