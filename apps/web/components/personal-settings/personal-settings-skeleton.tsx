import { Skeleton } from "@/components/shared/async-states";
import {
  PageSkeleton,
  SectionSkeleton,
  SkeletonField,
  SkeletonRows,
  SkeletonSectionLabel,
} from "@/components/shared/page-skeletons";

/** Quiet hours' fields and Save, for that section's own load. */
function QuietHoursFields() {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <SkeletonField />
        <SkeletonField />
      </div>
      <div className="flex justify-end">
        <Skeleton className="h-12 w-[136px] rounded-md" />
      </div>
    </div>
  );
}

export function QuietHoursSkeleton() {
  return (
    <SectionSkeleton label="Loading your preferences">
      <QuietHoursFields />
    </SectionSkeleton>
  );
}

/** Notification category rows: label, description, switch. */
export function NotificationSettingsSkeleton() {
  return (
    <SectionSkeleton label="Loading your notification settings">
      <SkeletonRows
        rows={6}
        trailing={["w-11 rounded-full"]}
        trailingHeight="h-6"
        rowClassName="py-3"
      />
    </SectionSkeleton>
  );
}

/** The rail's two groups: My account, then the chapter's. */
const RAIL_GROUPS = [
  ["w-24", "w-32", "w-16"],
  ["w-24", "w-28", "w-24"],
] as const;

/** The rail beside the open section, which is Notifications by default. */
function PersonalSettingsBody() {
  return (
    <div aria-hidden="true" className="@container">
      <div className="flex flex-col gap-6 @3xl:flex-row @3xl:items-start">
        <div className="flex w-full flex-col gap-3 @3xl:w-[200px] @3xl:shrink-0 @3xl:self-stretch @3xl:border-r @3xl:border-border @3xl:px-2 @3xl:py-3">
          {RAIL_GROUPS.map((group, index) => (
            <div key={index} className="flex flex-col gap-0.5">
              <Skeleton className="mx-[10px] mb-1 h-[11px] w-20" />
              <div className="flex flex-row flex-wrap gap-0.5 @3xl:flex-col">
                {group.map((width, row) => (
                  <div
                    key={row}
                    className="flex h-[34px] items-center px-[10px]"
                  >
                    <Skeleton className={`h-[13px] ${width}`} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="min-w-0 max-w-2xl flex-1 space-y-4 @3xl:py-3">
          <div className="space-y-2">
            <SkeletonSectionLabel width="w-32" />
            <Skeleton className="h-[11px] w-[45%]" />
          </div>
          <QuietHoursFields />
        </div>
      </div>
    </div>
  );
}

/** The page body while `?section=` resolves, under the live title. */
export function PersonalSettingsBodySkeleton() {
  return (
    <SectionSkeleton label="Loading your settings">
      <PersonalSettingsBody />
    </SectionSkeleton>
  );
}

/** `/preferences` while it loads. */
export function PersonalSettingsPageSkeleton() {
  return (
    <PageSkeleton label="Loading your settings">
      <PersonalSettingsBody />
    </PageSkeleton>
  );
}
