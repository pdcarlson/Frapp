import { Skeleton } from "@/components/shared/async-states";
import {
  PageSkeleton,
  SectionSkeleton,
  SkeletonField,
  SkeletonRows,
  SkeletonSectionLabel,
} from "@/components/shared/page-skeletons";

/** A `ProfileSection`'s label and hint line. */
function SectionHead() {
  return (
    <div className="space-y-2">
      <SkeletonSectionLabel width="w-32" />
      <Skeleton className="h-[11px] w-[45%]" />
    </div>
  );
}

/** Quiet hours' three fields and Save, for that section's own load. */
function QuietHoursFields() {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <SkeletonField />
        <SkeletonField />
        <SkeletonField />
      </div>
      <div className="flex justify-end">
        <Skeleton className="h-12 w-[136px] rounded-md" />
      </div>
    </div>
  );
}

/** Notification category rows: label, description, switch. */
function NotificationRows() {
  return (
    <SkeletonRows
      rows={6}
      trailing={["w-11 rounded-full"]}
      trailingHeight="h-6"
      rowClassName="py-3"
    />
  );
}

export function QuietHoursSkeleton() {
  return (
    <SectionSkeleton label="Loading your preferences">
      <QuietHoursFields />
    </SectionSkeleton>
  );
}

export function NotificationSettingsSkeleton() {
  return (
    <SectionSkeleton label="Loading your notification settings">
      <NotificationRows />
    </SectionSkeleton>
  );
}

/**
 * `/profile` while it loads: the 84px avatar beside name, email and photo
 * control, then the page's sections on its `max-w-2xl` column (directory
 * profile form, quiet hours, notifications).
 */
export function ProfilePageSkeleton() {
  return (
    <PageSkeleton label="Loading your profile">
      <div aria-hidden="true" className="max-w-2xl space-y-10">
        <div className="flex items-center gap-4">
          <Skeleton className="h-[84px] w-[84px] shrink-0 rounded-full" />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-[11px] w-44" />
            <Skeleton className="mt-1 h-8 w-[92px] rounded-md" />
          </div>
        </div>
        <section className="space-y-4">
          <SectionHead />
          <SkeletonField />
          <SkeletonField control="h-[88px]" />
          <div className="grid gap-3 sm:grid-cols-3">
            <SkeletonField />
            <SkeletonField />
            <SkeletonField />
          </div>
          <div className="flex justify-end">
            <Skeleton className="h-12 w-[112px] rounded-md" />
          </div>
        </section>
        <section className="space-y-4">
          <SectionHead />
          <QuietHoursFields />
        </section>
        <section className="space-y-4">
          <SectionHead />
          <NotificationRows />
        </section>
      </div>
    </PageSkeleton>
  );
}
