import { Skeleton } from "@/components/shared/async-states";
import {
  PageSkeleton,
  SkeletonSectionLabel,
} from "@/components/shared/page-skeletons";
import { denseListClassName } from "@/components/shared/table-controls";

/**
 * `/activity` while it loads, in the loaded page's own frames (#4766, #5779):
 * To do as a label over two-line rows with a badge at the end. The week ring
 * in the header fills in with the read.
 */
export function ActivityPageSkeleton() {
  return (
    <PageSkeleton label="Loading your activity" className="@container">
      <div className="space-y-8">
        <section className="space-y-3">
          <SkeletonSectionLabel width="w-16" count />
          <ul className={denseListClassName}>
            {Array.from({ length: 4 }, (_, row) => (
              <li
                key={row}
                className="flex min-h-14 items-center justify-between gap-3 px-2 py-2"
              >
                <Skeleton className="h-10 w-10 shrink-0 rounded-sm" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-[13px] w-[55%]" />
                  <Skeleton className="h-[11px] w-[35%]" />
                </div>
                <Skeleton className="h-6 w-16 rounded-md" />
              </li>
            ))}
          </ul>
        </section>
      </div>
    </PageSkeleton>
  );
}

/** The Archive while it loads (#5127): a label over a few rows, as it lands. */
export function ActivityArchiveSkeleton() {
  return (
    <PageSkeleton label="Loading your archive">
      <section className="space-y-3">
        <SkeletonSectionLabel width="w-16" count />
        <ul className={denseListClassName}>
          {Array.from({ length: 3 }, (_, row) => (
            <li
              key={row}
              className="flex min-h-14 items-center justify-between gap-3 px-2 py-2"
            >
              <Skeleton className="h-10 w-10 shrink-0 rounded-sm" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-[13px] w-[55%]" />
                <Skeleton className="h-[11px] w-[35%]" />
              </div>
            </li>
          ))}
        </ul>
      </section>
    </PageSkeleton>
  );
}
