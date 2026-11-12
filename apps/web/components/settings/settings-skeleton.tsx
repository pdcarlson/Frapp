import { Skeleton } from "@/components/shared/async-states";
import {
  PageSkeleton,
  SectionSkeleton,
  SkeletonField,
} from "@/components/shared/page-skeletons";

/** Officer tools, then the chapter-setup tabs: the rail's two groups. */
const RAIL_GROUPS = [
  ["w-20", "w-24", "w-[88px]", "w-16"],
  ["w-16", "w-14", "w-16", "w-12", "w-20", "w-12", "w-12", "w-20", "w-14"],
] as const;

/**
 * One settings card: the tabs draw `<Card>` (`--card`, radius 16, hairline),
 * so this one does too: its title, a two-column field grid, the Save button.
 */
function SettingsCard({ fields }: { fields: number }) {
  return (
    <div
      aria-hidden="true"
      className="space-y-4 rounded-xl border border-border bg-card p-4"
    >
      <Skeleton className="h-[15px] w-32" />
      <div className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: fields }, (_, index) => (
          <SkeletonField key={index} />
        ))}
      </div>
      <div className="flex justify-end">
        <Skeleton className="h-12 w-[112px] rounded-md" />
      </div>
    </div>
  );
}

function TabCards() {
  return (
    <div className="min-w-0 flex-1 space-y-4">
      <SettingsCard fields={3} />
      <SettingsCard fields={2} />
    </div>
  );
}

/**
 * A settings card that holds a list rather than a form (custom roles, custom
 * fields, chapter roles): title, description, then the bordered item rows the
 * loaded card draws, each a name line over its meta or capability chips.
 */
function SettingsListCard({ rows = 3 }: { rows?: number }) {
  return (
    <div
      aria-hidden="true"
      className="space-y-4 rounded-xl border border-border bg-card p-4"
    >
      <div className="space-y-2">
        <Skeleton className="h-[15px] w-36" />
        <Skeleton className="h-[11px] w-[60%]" />
      </div>
      <div className="space-y-3">
        {Array.from({ length: rows }, (_, row) => (
          <div
            key={row}
            className="space-y-3 rounded-md border border-border p-4"
          >
            <Skeleton
              className={row % 2 ? "h-[13px] w-[30%]" : "h-[13px] w-[42%]"}
            />
            <div className="flex flex-wrap gap-2">
              <Skeleton className="h-6 w-20 rounded-md" />
              <Skeleton className="h-6 w-24 rounded-md" />
              <Skeleton className="h-6 w-16 rounded-md" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** One list card, announced: a settings tab whose own list is still loading. */
export function SettingsListCardSkeleton({
  label,
  rows,
}: {
  label: string;
  rows?: number;
}) {
  return (
    <SectionSkeleton label={label} className="">
      <SettingsListCard rows={rows} />
    </SectionSkeleton>
  );
}

/** A settings tab's cards, for a tab whose own config is still loading. */
export function SettingsTabSkeleton() {
  return (
    <SectionSkeleton label="Loading chapter configuration">
      <TabCards />
    </SectionSkeleton>
  );
}

/** The rail beside a tab's cards: the page body under its title. */
function SettingsBody() {
  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
      <div
        aria-hidden="true"
        className="flex w-full flex-col gap-3 lg:w-[200px] lg:self-stretch lg:border-r lg:border-border lg:px-2 lg:py-3"
      >
        {RAIL_GROUPS.map((group, index) => (
          <div key={index} className="flex flex-col gap-0.5">
            <Skeleton className="mx-[10px] mb-1 h-[11px] w-14" />
            <div className="flex flex-row flex-wrap gap-0.5 lg:flex-col">
              {group.map((width, row) => (
                <div key={row} className="flex h-9 items-center px-[10px]">
                  <Skeleton className={`h-[13px] ${width}`} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <TabCards />
    </div>
  );
}

/** The page body while the chapter loads, under the live title. */
export function SettingsBodySkeleton() {
  return (
    <SectionSkeleton label="Loading chapter settings">
      <SettingsBody />
    </SectionSkeleton>
  );
}

/** `/settings` while it loads. */
export function SettingsPageSkeleton() {
  return (
    <PageSkeleton label="Loading chapter settings">
      <SettingsBody />
    </PageSkeleton>
  );
}
