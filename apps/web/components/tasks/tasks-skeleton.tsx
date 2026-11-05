import { Skeleton } from "@/components/shared/async-states";
import {
  PageSkeleton,
  SkeletonFrame,
  SkeletonSectionLabel,
} from "@/components/shared/page-skeletons";

/** Cards per status column, tapering the way a real board usually does. */
const COLUMN_CARDS = [3, 3, 2, 1] as const;

/**
 * `/tasks` while it loads: the four status columns, each a label over task
 * cards drawn in the real card's frame (radius 14, hairline, no fill) with its
 * title, description, meta row and action row.
 */
export function TasksPageSkeleton() {
  return (
    <PageSkeleton label="Loading chapter tasks">
      <div className="grid gap-x-6 gap-y-8 md:grid-cols-2 xl:grid-cols-4">
        {COLUMN_CARDS.map((cards, column) => (
          <section key={column} className="space-y-3">
            <SkeletonSectionLabel width="w-20" count />
            <div className="space-y-2">
              {Array.from({ length: cards }, (_, card) => (
                <SkeletonFrame key={card} className="space-y-2 p-3">
                  <Skeleton className="h-[13px] w-[72%]" />
                  <Skeleton className="h-[11px] w-[90%]" />
                  <Skeleton className="h-[11px] w-[55%]" />
                  <div className="flex items-center gap-2 pt-1">
                    <Skeleton className="h-[11px] w-[45%]" />
                    <Skeleton className="h-6 w-12 rounded-md" />
                  </div>
                  <div className="flex items-center justify-between pt-2">
                    <Skeleton className="h-8 w-16 rounded-md" />
                    <Skeleton className="h-8 w-8 rounded-md" />
                  </div>
                </SkeletonFrame>
              ))}
            </div>
          </section>
        ))}
      </div>
    </PageSkeleton>
  );
}
