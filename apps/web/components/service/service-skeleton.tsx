import {
  PageSkeleton,
  SkeletonRows,
  SkeletonSectionLabel,
} from "@/components/shared/page-skeletons";
import { Skeleton } from "@/components/shared/async-states";

/**
 * `/service` while it loads, in the loaded page's order (#4669): Your
 * service hours (three stats over your log) beside the leaderboard on a wide
 * page and above it beside chat, then the queue officers see.
 */
export function ServicePageSkeleton() {
  return (
    <PageSkeleton label="Loading service hours">
      <div className="grid gap-8 @4xl:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
        <section className="space-y-4">
          <SkeletonSectionLabel width="w-32" />
          <div className="grid grid-cols-[repeat(auto-fit,minmax(7.5rem,1fr))] gap-4">
            {[0, 1, 2].map((stat) => (
              <div key={stat} className="space-y-2">
                <Skeleton className="h-[11px] w-20" />
                <Skeleton className="h-[20px] w-16" />
              </div>
            ))}
          </div>
          <div className="space-y-2">
            <SkeletonSectionLabel width="w-16" count />
            <SkeletonRows
              rows={3}
              lines={2}
              trailing={["w-20", "w-16"]}
              trailingHeight="h-6"
            />
          </div>
        </section>
        <section className="space-y-3">
          <SkeletonSectionLabel width="w-24" count />
          <SkeletonRows rows={5} lines={1} trailing={["w-12"]} />
        </section>
      </div>
      <section className="space-y-3">
        <SkeletonSectionLabel width="w-24" count />
        <SkeletonRows rows={3} lines={3} trailing={["w-24", "w-16"]} />
      </section>
    </PageSkeleton>
  );
}
