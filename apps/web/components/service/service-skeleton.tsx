import {
  PageSkeleton,
  SkeletonRows,
  SkeletonSectionLabel,
} from "@/components/shared/page-skeletons";

/**
 * `/service` while it loads: the two
 * flush sections the page draws (the queue officers see, then History), each
 * a label over three-line rows with their trailing controls.
 */
export function ServicePageSkeleton() {
  return (
    <PageSkeleton label="Loading service hours">
      <section className="space-y-3">
        <SkeletonSectionLabel width="w-24" count />
        <SkeletonRows rows={3} lines={3} trailing={["w-24", "w-16"]} />
      </section>
      <section className="space-y-3">
        <SkeletonSectionLabel width="w-16" />
        <SkeletonRows
          rows={4}
          lines={3}
          trailing={["w-20", "w-24"]}
          trailingHeight="h-6"
        />
      </section>
    </PageSkeleton>
  );
}
