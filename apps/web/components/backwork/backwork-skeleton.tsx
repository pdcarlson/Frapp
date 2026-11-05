import { Skeleton } from "@/components/shared/async-states";
import {
  PageSkeleton,
  SectionSkeleton,
  SkeletonRows,
} from "@/components/shared/page-skeletons";

/**
 * Library rows: a type tag, the title over its course line, then Download and
 * the row's ⋯ button (the 2026-11-05 layout, `backwork-page.tsx`).
 */
function ResourceRows() {
  return (
    <SkeletonRows
      rows={8}
      trailing={["w-8", "w-8"]}
      rowClassName="min-h-12 py-2"
    />
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
 * `/backwork` while it loads: the toolbar row (search, five filter chips, the
 * count and Upload), then the rows.
 */
export function BackworkPageSkeleton() {
  return (
    <PageSkeleton label="Loading backwork" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-9 min-w-[220px] flex-[1_1_280px] rounded-[10px]" />
        <div className="flex flex-wrap gap-1.5">
          {["w-20", "w-24", "w-16", "w-16", "w-16"].map((width, index) => (
            <Skeleton key={index} className={`h-9 ${width} rounded-full`} />
          ))}
        </div>
        <Skeleton className="ml-auto h-9 w-20 rounded-md" />
      </div>
      <ResourceRows />
    </PageSkeleton>
  );
}
