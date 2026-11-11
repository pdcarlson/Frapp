import { Skeleton } from "@/components/shared/async-states";
import {
  PageSkeleton,
  SkeletonControl,
  SkeletonSectionLabel,
} from "@/components/shared/page-skeletons";
import { denseListClassName } from "@/components/shared/table-controls";

/** Rows per group, tapering the way the loaded page usually does. */
const GROUP_ROWS = [4, 3, 3] as const;

/**
 * `/activity` while it loads: the chip row, then the three groups, each a
 * label over two-line rows with a badge at the end, in the loaded page's own
 * list frame.
 */
export function ActivityPageSkeleton() {
  return (
    <PageSkeleton label="Loading your activity" className="space-y-8">
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 6 }, (_, chip) => (
          <SkeletonControl key={chip} className="w-16 rounded-full" />
        ))}
      </div>
      {GROUP_ROWS.map((rows, group) => (
        <section key={group} className="space-y-3">
          <SkeletonSectionLabel width="w-24" count />
          <ul className={denseListClassName}>
            {Array.from({ length: rows }, (_, row) => (
              <li
                key={row}
                className="flex min-h-14 items-center justify-between gap-3 py-2"
              >
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-[13px] w-[55%]" />
                  <Skeleton className="h-[11px] w-[35%]" />
                </div>
                <Skeleton className="h-6 w-16 rounded-md" />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </PageSkeleton>
  );
}
