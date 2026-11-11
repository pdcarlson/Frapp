import { Skeleton } from "@/components/shared/async-states";
import {
  PageSkeleton,
  SkeletonField,
  SkeletonSectionLabel,
} from "@/components/shared/page-skeletons";

/** A `ProfileSection`'s label and hint line. */
function SectionHead() {
  return (
    <div className="space-y-2">
      <SkeletonSectionLabel width="w-32" />
      <Skeleton className="h-[11px] w-[45%]" />
    </div>
  );
}

/**
 * `/profile` while it loads: the 84px avatar beside name, email and photo
 * control, then the directory profile form on its `max-w-2xl` column.
 */
export function ProfilePageSkeleton() {
  return (
    <PageSkeleton label="Loading your profile">
      <div aria-hidden="true" className="max-w-2xl space-y-10">
        <div className="flex items-center gap-4">
          <Skeleton className="h-[84px] w-[84px] shrink-0 rounded-full" />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-[11px] w-44" />
            <Skeleton className="mt-1 h-8 w-[92px] rounded-md" />
          </div>
        </div>
        <section className="space-y-4">
          <SectionHead />
          <SkeletonField />
          <SkeletonField control="h-[88px]" />
          <div className="grid gap-3 sm:grid-cols-3">
            <SkeletonField />
            <SkeletonField />
            <SkeletonField />
          </div>
          <div className="flex justify-end">
            <Skeleton className="h-12 w-[112px] rounded-md" />
          </div>
        </section>
      </div>
    </PageSkeleton>
  );
}
