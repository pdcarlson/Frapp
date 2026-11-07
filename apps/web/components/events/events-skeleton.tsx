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
 * List/Calendar toggle), then the list view's select-all header and its
 * checkbox rows. No New event placeholder: the button is `events:create`
 * only, and a placeholder for a gated control draws a row that then vanishes
 * (`components.md` §10 Skeleton). A chapter with no events opens on the
 * calendar instead of these rows; nothing knows that until the read lands.
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
