import { Skeleton } from "@/components/shared/async-states";
import {
  SectionSkeleton,
  SkeletonRows,
} from "@/components/shared/page-skeletons";
import { stateMicrocopy } from "@/lib/state-microcopy";

/**
 * The plan panel in its own frame: `--surface-1`, radius 16, hairline, which
 * is what the loaded panel paints (it is the page's one framed block). Plan
 * name and badge, the meta line, and the button column.
 */
function PlanPanelFrame() {
  return (
    <div
      aria-hidden="true"
      className="flex flex-col gap-4 rounded-xl border border-border bg-surface-1 p-5 @xl:flex-row @xl:items-center @xl:gap-6"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex items-center gap-2.5">
          <Skeleton className="h-[22px] w-20" />
          <Skeleton className="h-5 w-14 rounded-md" />
        </div>
        <Skeleton className="h-[11px] w-16" />
      </div>
      <Skeleton className="h-11 w-[156px] rounded-md" />
    </div>
  );
}

/** The plan panel's own first load (and the billing page's Suspense fallback). */
export function PlanPanelSkeleton() {
  return (
    <SectionSkeleton label="Loading your plan" className="">
      <PlanPanelFrame />
    </SectionSkeleton>
  );
}

/** Invoice rows: checkbox, title and member line, amount, status, actions. */
function InvoiceRows() {
  return (
    <SkeletonRows
      rows={5}
      lead="checkbox"
      trailing={["w-14", "w-14", "w-20", "w-12"]}
    />
  );
}

/** The invoice rows, for the list's own first load under its toolbar. */
export function InvoiceRowsSkeleton() {
  return (
    <SectionSkeleton label={stateMicrocopy.billing.loading}>
      <InvoiceRows />
    </SectionSkeleton>
  );
}
