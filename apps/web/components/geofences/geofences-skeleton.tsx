import {
  PageSkeleton,
  SectionSkeleton,
  SkeletonRows,
} from "@/components/shared/page-skeletons";

/** Zone rows: pin glyph, name and rule line, status badge, three actions. */
function ZoneRows() {
  return (
    <SkeletonRows
      rows={3}
      lead="glyph"
      trailing={["w-14", "w-12", "w-20", "w-20"]}
      rowClassName="min-h-11 py-2.5"
    />
  );
}

/**
 * The zone list under the live action row: its own first load (`className=""`,
 * inside the page's `mt-4` body) or the permission check (outside it).
 */
export function GeofenceRowsSkeleton({
  className = "mt-4 space-y-4",
}: {
  className?: string;
}) {
  return (
    <SectionSkeleton label="Loading study zones" className={className}>
      <ZoneRows />
    </SectionSkeleton>
  );
}

/** `/geofences` while it loads: the zones. Its controls are manager-only, so no row is drawn for them. */
export function GeofencesPageSkeleton() {
  return (
    <PageSkeleton label="Loading study zones">
      <ZoneRows />
    </PageSkeleton>
  );
}
