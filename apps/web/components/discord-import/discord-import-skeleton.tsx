import { Skeleton } from "@/components/shared/async-states";
import {
  SectionSkeleton,
  SkeletonSectionLabel,
} from "@/components/shared/page-skeletons";
import { denseListClassName } from "@/components/shared/table-controls";

/**
 * The Imports section of `/discord-import`: its label and New
 * import button, then import rows (server name and status badge, the progress
 * caption and meter).
 */
export function DiscordImportsSkeleton() {
  return (
    <SectionSkeleton label="Loading imports" className="space-y-3">
      <div aria-hidden="true" className="flex items-center gap-2">
        <div className="mr-auto">
          <SkeletonSectionLabel width="w-16" />
        </div>
        <Skeleton className="h-12 w-[112px] rounded-md" />
      </div>
      <ul aria-hidden="true" className={denseListClassName}>
        {[0, 1].map((row) => (
          <li key={row} className="min-h-11 space-y-2 py-3">
            <div className="flex items-center gap-2">
              <Skeleton className="h-[13px] w-40" />
              <Skeleton className="h-[11px] w-20" />
              <div className="flex-1" />
              <Skeleton className="h-5 w-20 rounded-md" />
            </div>
            <div className="flex items-center gap-3">
              <Skeleton className="h-[11px] w-24" />
              <Skeleton className="h-1.5 flex-1 rounded-full" />
            </div>
          </li>
        ))}
      </ul>
    </SectionSkeleton>
  );
}
