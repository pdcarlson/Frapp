import { Skeleton } from "@/components/shared/async-states";
import { SectionSkeleton } from "@/components/shared/page-skeletons";

/**
 * `/discord-import` while its one read loads: the chapter's import in the
 * page's centred column, a heading, a line under it, and a row of figures.
 * Which state the import is in is not known yet, so it draws the shape every
 * state shares rather than any one of them.
 */
export function DiscordImportSkeleton() {
  return (
    <SectionSkeleton
      label="Loading the import"
      className="@container mx-auto w-full max-w-2xl space-y-4"
    >
      <div aria-hidden="true" className="space-y-2">
        <Skeleton className="h-[11px] w-28" />
        <Skeleton className="h-7 w-80 max-w-full" />
        <Skeleton className="h-[13px] w-96 max-w-full" />
      </div>
      <div aria-hidden="true" className="grid grid-cols-2 gap-3 @xl:grid-cols-3">
        {[0, 1, 2].map((figure) => (
          <Skeleton key={figure} className="h-[68px] rounded-lg" />
        ))}
      </div>
    </SectionSkeleton>
  );
}
