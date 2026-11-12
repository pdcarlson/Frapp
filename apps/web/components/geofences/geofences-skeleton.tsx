import {
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

/** The zone list on Chapter settings' Study zones page while it loads. */
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
