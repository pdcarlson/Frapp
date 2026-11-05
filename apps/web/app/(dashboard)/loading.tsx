import {
  PageSkeleton,
  SkeletonRows,
  SkeletonSectionLabel,
} from "@/components/shared/page-skeletons";

/**
 * The fallback for a dashboard route that has no `loading.tsx` of its own.
 * Every route ships one, so this should only ever cover a route added since;
 * it is the page grammar in general (title row, a labelled flush list) rather
 * than a card, so even then it is the right colour and shape.
 */
export default function DashboardLoading() {
  return (
    <PageSkeleton label="Loading">
      <section className="space-y-3">
        <SkeletonSectionLabel count />
        <SkeletonRows rows={6} />
      </section>
    </PageSkeleton>
  );
}
