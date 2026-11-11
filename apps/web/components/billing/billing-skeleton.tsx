import { PlanMatrix } from "@/components/billing/plan-matrix";
import { Skeleton } from "@/components/shared/async-states";
import {
  PageSkeleton,
  SectionSkeleton,
  SkeletonControl,
  SkeletonRows,
  SkeletonSectionLabel,
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

/**
 * `/billing` while it loads: the plan panel, the plan matrix (real, since it
 * needs no data), then the invoice toolbar and rows.
 */
export function BillingPageSkeleton() {
  return (
    <PageSkeleton label="Loading billing" className="@container space-y-6">
      <PlanPanelFrame />
      {/*
        The real matrix: it is static (the module catalogue, no query), so the
        skeleton renders it as it is rather than a picture of it.
      */}
      <PlanMatrix />
      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="mr-auto">
            <SkeletonSectionLabel width="w-20" count />
          </div>
          <SkeletonControl className="w-full @md:w-64" />
          <SkeletonControl className="w-[92px]" />
          <SkeletonControl className="w-[132px]" />
        </div>
        <InvoiceRows />
      </section>
    </PageSkeleton>
  );
}
