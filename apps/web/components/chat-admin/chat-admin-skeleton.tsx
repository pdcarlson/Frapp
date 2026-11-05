import { Skeleton } from "@/components/shared/async-states";
import {
  SectionSkeleton,
  SkeletonControl,
  SkeletonRows,
  SkeletonSectionLabel,
} from "@/components/shared/page-skeletons";
import { denseListClassName } from "@/components/shared/table-controls";
import { chatReportCopy } from "@/components/chat-admin/chat-report-copy";

/** Reported-message rows: name and time, the quoted message, the actions. */
function ReportRows() {
  return (
    <ul aria-hidden="true" className={denseListClassName}>
      {[0, 1].map((row) => (
        <li key={row} className="min-h-11 space-y-3 py-3">
          <div className="flex items-center gap-2">
            <Skeleton className="h-[13px] w-28" />
            <Skeleton className="h-[11px] w-16" />
          </div>
          <Skeleton className="h-[13px] w-[60%]" />
          <div className="flex gap-2">
            <Skeleton className="h-8 w-20 rounded-md" />
            <Skeleton className="h-8 w-24 rounded-md" />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** The report queue's rows, for the queue's own load under its tabs. */
export function ReportRowsSkeleton() {
  return (
    <SectionSkeleton label={chatReportCopy.loading}>
      <ReportRows />
    </SectionSkeleton>
  );
}

/**
 * Channels, then Categories: the toolbar and New channel, the channel rows
 * beside the edit pane, the category rows.
 */
function ChannelsBody() {
  return (
    <div aria-hidden="true" className="space-y-8">
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <div className="mr-auto">
            <SkeletonSectionLabel width="w-20" count />
          </div>
          <SkeletonControl className="w-[128px]" />
        </div>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
          <SkeletonRows
            rows={5}
            lines={1}
            trailing={["w-14", "w-16", "w-8"]}
            trailingHeight="h-5"
            rowClassName="min-h-9 pointer-coarse:min-h-11"
          />
          <div className="space-y-3 lg:border-l lg:border-border lg:pl-6">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-[11px] w-[55%]" />
          </div>
        </div>
      </section>
      <section className="space-y-3">
        <SkeletonSectionLabel width="w-24" count />
        <SkeletonRows rows={2} lines={1} trailing={["w-8", "w-8"]} />
      </section>
    </div>
  );
}

/** The channels body, for its own load under the report queue. */
export function ChannelsSkeleton() {
  return (
    <SectionSkeleton label="Loading channels">
      <ChannelsBody />
    </SectionSkeleton>
  );
}

/**
 * Everything `/chat-admin` draws: the report queue (label, its
 * caption, the status tabs, rows) over the channels body. The permission
 * check and the route loader both show this.
 */
export function ChatAdminBodySkeleton() {
  return (
    <SectionSkeleton label="Loading chat admin">
      <section aria-hidden="true" className="space-y-3">
        <SkeletonSectionLabel width="w-36" />
        <Skeleton className="h-[11px] w-[40%]" />
        <div className="flex h-11 items-center gap-6 border-b border-border">
          <Skeleton className="h-[13px] w-10" />
          <Skeleton className="h-[13px] w-16" />
          <Skeleton className="h-[13px] w-16" />
          <Skeleton className="h-[13px] w-16" />
        </div>
        <ReportRows />
      </section>
      <ChannelsBody />
    </SectionSkeleton>
  );
}
