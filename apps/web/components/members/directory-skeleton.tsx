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
 * The Actives roster while it loads: its toolbar (label, search, four
 * filters, Invite), the select-all line, then the dense member rows (checkbox,
 * 24px avatar, name, the role and email caption, points).
 */
function RosterBody() {
  return (
    <div className="@container space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto">
          <SkeletonSectionLabel width="w-16" count />
        </div>
        <SkeletonControl className="w-full @md:w-56" />
        <SkeletonControl className="w-[112px]" />
        <SkeletonControl className="w-[132px]" />
        <SkeletonControl className="w-[112px]" />
        <SkeletonControl className="w-[132px]" />
        <SkeletonControl className="w-[124px]" />
      </div>
      <div className="flex h-6 items-center gap-2">
        <Skeleton className="h-6 w-6 rounded-[7px]" />
        <Skeleton className="h-[11px] w-28" />
      </div>
      <MemberRows />
    </div>
  );
}

function MemberRows() {
  return (
    <SkeletonRows
      rows={10}
      lines={1}
      lead={["checkbox", "avatar"]}
      trailing={["hidden w-56 @2xl:block", "w-10"]}
      trailingHeight="h-[11px]"
      rowClassName="min-h-9 py-1.5 pointer-coarse:min-h-11"
    />
  );
}

/** The member rows alone, for a search in flight under the live toolbar. */
export function MemberRowsSkeleton() {
  return (
    <SectionSkeleton label={stateMicrocopy.members.loading} className="">
      <MemberRows />
    </SectionSkeleton>
  );
}

/** The roster on its own, for the Actives tab's first load. */
export function MembersRosterSkeleton() {
  return (
    <SectionSkeleton label={stateMicrocopy.members.loading}>
      <RosterBody />
    </SectionSkeleton>
  );
}

/** The Alumni tab's rows, under its live search form. */
export function AlumniRowsSkeleton() {
  return (
    <SectionSkeleton label="Loading alumni directory">
      <SkeletonRows rows={8} lead="avatar" />
    </SectionSkeleton>
  );
}

/** The Actives/Alumni tab row over the roster. */
function DirectoryBody() {
  return (
    <div className="space-y-3">
      <div
        aria-hidden="true"
        className="flex h-11 items-center gap-6 border-b border-border"
      >
        <Skeleton className="h-[13px] w-14" />
        <Skeleton className="h-[13px] w-12" />
      </div>
      <RosterBody />
    </div>
  );
}

/** Everything under the live title, while the tabs' search params resolve. */
export function DirectoryBodySkeleton() {
  return (
    <SectionSkeleton label="Loading directory">
      <DirectoryBody />
    </SectionSkeleton>
  );
}

/** `/members` while it loads: the title, the Actives/Alumni tabs, the roster. */
export function DirectoryPageSkeleton() {
  return (
    <PageSkeleton label="Loading directory">
      <DirectoryBody />
    </PageSkeleton>
  );
}
