import { Skeleton } from "@/components/shared/async-states";
import {
  PageSkeleton,
  SectionSkeleton,
  SkeletonControl,
  SkeletonRows,
} from "@/components/shared/page-skeletons";

/**
 * The column header (md and up) and the library rows: two lines, then
 * Download and the row's ⋯ button at the shared compact control size
 * (`backwork-page.tsx`, 2026-11-05 layout).
 */
function ResourceRows() {
  return (
    <div>
      <div aria-hidden="true" className="hidden px-2 pb-1.5 md:block">
        <Skeleton className="h-[12.5px] w-40" />
      </div>
      <SkeletonRows
        rows={8}
        trailing={["w-8", "w-8"]}
        trailingHeight="h-8 pointer-coarse:h-11"
        rowClassName="px-2 py-2 md:min-h-12"
      />
    </div>
  );
}

/** The list, for its own first load under the live toolbar. */
export function BackworkRowsSkeleton() {
  return (
    <SectionSkeleton label="Loading backwork">
      <ResourceRows />
    </SectionSkeleton>
  );
}

/**
 * `/backwork` while it loads: the toolbar's search field and five filter
 * chips, which every member sees, then the rows. Upload and the officers'
 * More button sit behind `<Can>`, so they get no placeholder
 * (`page-skeletons.tsx`).
 */
export function BackworkPageSkeleton() {
  return (
    <PageSkeleton label="Loading backwork" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <SkeletonControl className="min-w-[220px] flex-[1_1_280px]" />
        <div className="flex flex-wrap gap-1.5">
          {["w-20", "w-24", "w-16", "w-16", "w-16"].map((width, index) => (
            <SkeletonControl key={index} className={`${width} rounded-full`} />
          ))}
        </div>
      </div>
      <ResourceRows />
    </PageSkeleton>
  );
}
