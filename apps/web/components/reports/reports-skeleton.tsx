import { Skeleton } from "@/components/shared/async-states";
import {
  SectionSkeleton,
  SkeletonField,
} from "@/components/shared/page-skeletons";

/**
 * The `/reports` form, while the export permission is still
 * being checked: report picker and its description, the date fields, the
 * action row, and the Preview heading.
 */
export function ReportsFormSkeleton() {
  return (
    <SectionSkeleton label="Checking your chapter permissions">
      <div aria-hidden="true" className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-2">
            <SkeletonField />
            <Skeleton className="h-[11px] w-[70%]" />
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <SkeletonField />
          <SkeletonField />
          <SkeletonField />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="mr-auto h-[11px] w-[260px]" />
          <Skeleton className="h-12 w-[128px] rounded-md" />
          <Skeleton className="h-12 w-[128px] rounded-md" />
          <Skeleton className="h-12 w-[148px] rounded-md" />
        </div>
      </div>
      <div aria-hidden="true" className="space-y-2">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-[11px] w-[40%]" />
      </div>
    </SectionSkeleton>
  );
}
