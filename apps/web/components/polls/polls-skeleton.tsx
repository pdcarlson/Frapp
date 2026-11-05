import { Skeleton } from "@/components/shared/async-states";
import {
  PageSkeleton,
  SectionSkeleton,
  SkeletonControl,
  SkeletonFrame,
} from "@/components/shared/page-skeletons";

/** Option rows per poll card. */
const OPTIONS = [3, 3, 4, 2] as const;

/**
 * The poll cards: the real card frame (radius 14, hairline, no fill) with its
 * title, meta line and status badge, the bordered option rows with their
 * meters, and the footer line.
 */
function PollCards() {
  return (
    <ul aria-hidden="true" className="grid gap-4 md:grid-cols-2">
      {OPTIONS.map((options, card) => (
        <li key={card}>
          <SkeletonFrame className="flex flex-col gap-4 p-4">
            <div className="flex items-start gap-3">
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-[15px] w-[60%]" />
                <Skeleton className="h-[11px] w-[45%]" />
              </div>
              <Skeleton className="h-6 w-14 rounded-md" />
            </div>
            <div className="flex flex-col gap-2">
              {Array.from({ length: options }, (_, option) => (
                <div
                  key={option}
                  className="flex flex-col gap-2 rounded-md border border-border p-3"
                >
                  <div className="flex items-center justify-between">
                    <Skeleton className="h-[13px] w-[35%]" />
                    <Skeleton className="h-[11px] w-16" />
                  </div>
                  <Skeleton className="h-1.5 w-[30%] rounded-full" />
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between">
              <Skeleton className="h-[11px] w-20" />
              <Skeleton className="h-8 w-[104px] rounded-md" />
            </div>
          </SkeletonFrame>
        </li>
      ))}
    </ul>
  );
}

/** The poll grid, for its own first load under the live toolbar. */
export function PollCardsSkeleton() {
  return (
    <SectionSkeleton label="Loading chapter polls" className="">
      <PollCards />
    </SectionSkeleton>
  );
}

/** `/polls` while it loads: the channel and status filters and refresh, then the cards. */
export function PollsPageSkeleton() {
  return (
    <PageSkeleton
      label="Loading chapter polls"
      className="space-y-4"
      actions={
        <>
          <SkeletonControl className="w-[160px]" />
          <SkeletonControl className="w-[140px]" />
          <SkeletonControl className="w-9" />
        </>
      }
    >
      <PollCards />
    </PageSkeleton>
  );
}
