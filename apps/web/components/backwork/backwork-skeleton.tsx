import { Skeleton } from "@/components/shared/async-states";
import {
  PageSkeleton,
  SectionSkeleton,
  SkeletonField,
  SkeletonRows,
  SkeletonSectionLabel,
} from "@/components/shared/page-skeletons";

/** Resource rows: title, the course line, Redacted and Download. */
function ResourceRows() {
  return <SkeletonRows rows={8} trailing={["w-20", "w-24"]} />;
}

/** The results list, for its own first load under the live filter form. */
export function BackworkRowsSkeleton() {
  return (
    <SectionSkeleton label="Loading backwork">
      <ResourceRows />
    </SectionSkeleton>
  );
}

/**
 * `/backwork` while it loads: the filter form on
 * its three-column grid, then the Resources label over its rows.
 */
export function BackworkPageSkeleton() {
  return (
    <PageSkeleton label="Loading backwork">
      <div className="grid gap-3 md:grid-cols-3">
        <SkeletonField className="md:col-span-2" />
        <SkeletonField />
        <SkeletonField />
        <SkeletonField />
        <SkeletonField />
        <SkeletonField />
        <div className="flex gap-2 md:col-span-3">
          <Skeleton className="h-12 w-[112px] rounded-md" />
          <Skeleton className="h-12 w-[72px] rounded-md" />
        </div>
      </div>
      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <Skeleton className="h-4 w-4 rounded-[4px]" />
          <SkeletonSectionLabel width="w-20" count />
        </div>
        <div className="pt-2">
          <ResourceRows />
        </div>
      </section>
    </PageSkeleton>
  );
}
