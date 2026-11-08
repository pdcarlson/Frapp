import { Skeleton } from "@/components/shared/async-states";
import {
  PageSkeleton,
  SkeletonSectionLabel,
} from "@/components/shared/page-skeletons";

/**
 * The page is static, so this shows only while the route's code loads: the
 * first entry's date label, title and a few lines, on the page's own column.
 */
export default function Loading() {
  return (
    <PageSkeleton label="Loading what's new" className="max-w-2xl space-y-3">
      <SkeletonSectionLabel />
      <Skeleton className="h-4 w-64" />
      {["w-full", "w-11/12", "w-4/5", "w-3/4"].map((width) => (
        <Skeleton key={width} className={`h-4 ${width}`} />
      ))}
    </PageSkeleton>
  );
}
