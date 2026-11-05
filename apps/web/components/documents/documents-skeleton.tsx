import { Skeleton } from "@/components/shared/async-states";
import {
  PageSkeleton,
  SectionSkeleton,
  SkeletonControl,
  SkeletonRows,
  SkeletonSectionLabel,
} from "@/components/shared/page-skeletons";

/** The document rows: glyph, title and upload line, Download and delete. */
function DocumentRows() {
  return <SkeletonRows rows={8} lead="glyph" trailing={["w-24", "w-8"]} />;
}

/** The list column's rows, for the list's own first load under its toolbar. */
export function DocumentRowsSkeleton() {
  return (
    <SectionSkeleton label="Loading chapter documents">
      <DocumentRows />
    </SectionSkeleton>
  );
}

/**
 * `/documents` while it loads: the folder rail beside the list
 * (label and search over the document rows), on the page's own grid.
 */
export function DocumentsPageSkeleton() {
  return (
    <PageSkeleton label="Loading chapter documents">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-x-6 gap-y-4 md:grid-cols-[200px_minmax(0,1fr)]">
        <div className="space-y-1">
          <div className="flex min-h-9 items-center">
            <SkeletonSectionLabel width="w-16" />
          </div>
          {["w-20", "w-24", "w-28", "w-32", "w-20"].map((width, index) => (
            <div key={index} className="flex min-h-9 items-center gap-2 px-2">
              <Skeleton className="h-4 w-4 rounded-[4px]" />
              <Skeleton className={`h-[13px] ${width}`} />
            </div>
          ))}
        </div>
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="mr-auto">
              <SkeletonSectionLabel width="w-28" count />
            </div>
            <SkeletonControl className="w-full sm:w-64" />
          </div>
          <div className="pt-2">
            <DocumentRows />
          </div>
        </div>
      </div>
    </PageSkeleton>
  );
}
