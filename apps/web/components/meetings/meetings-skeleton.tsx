import {
  PageSkeleton,
  SectionSkeleton,
  SkeletonRows,
  SkeletonSectionLabel,
} from "@/components/shared/page-skeletons";
import { SkeletonText } from "@/components/shared/async-states";

/** The minutes rows: a name over the type and day. */
export function MeetingRowsSkeleton() {
  return (
    <SectionSkeleton label="Loading minutes">
      <div className="space-y-2">
        <SkeletonSectionLabel width="w-20" count />
        <SkeletonRows rows={6} lines={2} />
      </div>
    </SectionSkeleton>
  );
}

/** `/meetings` while it loads. */
export function MeetingsPageSkeleton() {
  return (
    <PageSkeleton label="Loading minutes" className="space-y-6">
      <div className="space-y-2">
        <SkeletonSectionLabel width="w-20" count />
        <SkeletonRows rows={6} lines={2} />
      </div>
    </PageSkeleton>
  );
}

/** `/meetings/:id` while it loads: the heading, then a few sections of text. */
export function MinutesPageSkeleton() {
  return (
    <PageSkeleton
      label="Loading minutes"
      className="mx-auto max-w-3xl space-y-8"
    >
      <SkeletonText lines={2} />
      <div className="space-y-2">
        <SkeletonSectionLabel width="w-24" />
        <SkeletonText lines={3} />
      </div>
      <div className="space-y-2">
        <SkeletonSectionLabel width="w-28" />
        <SkeletonText lines={4} />
      </div>
    </PageSkeleton>
  );
}
