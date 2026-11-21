import { Skeleton } from "@/components/shared/async-states";
import {
  PageSkeleton,
  SkeletonControl,
  SkeletonRows,
  SkeletonSectionLabel,
} from "@/components/shared/page-skeletons";
import { stateMicrocopy } from "@/lib/state-microcopy";

/**
 * `/events` while it loads, in the agenda's layout (#5560): the toolbar at
 * the trailing edge (search, Filter, Subscribe; icons beside chat), then the
 * navigator (a small month and the colour key beside the agenda on a pane
 * 720px or wider, a week strip over it narrower) and the agenda's day
 * headings and rows. No New event placeholder: the button is gated on
 * `EVENT_CREATE_PERMISSIONS`, and a placeholder for a gated control draws a
 * row that then vanishes (`components.md` §10 Skeleton).
 *
 * The page measures its width to pick the navigator; the skeleton has no
 * box to measure yet, so container queries on the same 720px draw it.
 */
export function EventsPageSkeleton() {
  return (
    <PageSkeleton
      label={stateMicrocopy.events.loading}
      className="@container space-y-4"
      actions={
        <>
          <SkeletonControl className="w-9 @[720px]:w-56" />
          <SkeletonControl className="w-9 @[720px]:w-[84px]" />
          <SkeletonControl className="w-9 @[720px]:w-[124px]" />
        </>
      }
    >
      <div className="flex flex-col gap-3 @[720px]:flex-row @[720px]:items-start @[720px]:gap-6">
        {/* The week strip, beside chat. */}
        <div className="flex items-center gap-1 @[720px]:hidden">
          {Array.from({ length: 7 }, (_, index) => (
            <div
              key={index}
              className="flex flex-1 flex-col items-center gap-1"
            >
              <Skeleton className="h-3 w-3" />
              <Skeleton className="h-7 w-7 rounded-full" />
            </div>
          ))}
        </div>
        {/* The small month and the colour key, on a wide pane. */}
        <div className="hidden w-[260px] shrink-0 space-y-3 @[720px]:block">
          <Skeleton className="h-5 w-32" />
          <div className="grid grid-cols-7 gap-2">
            {Array.from({ length: 35 }, (_, index) => (
              <Skeleton key={index} className="mx-auto h-7 w-7 rounded-full" />
            ))}
          </div>
          <div className="space-y-2 pt-1">
            {["w-20", "w-16", "w-24"].map((width) => (
              <Skeleton key={width} className={`h-4 ${width}`} />
            ))}
          </div>
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex min-h-9 items-center px-2">
            <SkeletonSectionLabel width="w-20" count />
          </div>
          {["w-12", "w-16", "w-20"].map((width) => (
            <div key={width} className="space-y-1">
              <Skeleton className={`mx-2 mt-3 h-3 ${width}`} />
              <SkeletonRows rows={2} lead="glyph" />
            </div>
          ))}
        </div>
      </div>
    </PageSkeleton>
  );
}
