import { InfoCard, ScreenShell } from "@/components/screen-shell";

/**
 * s12 — Documents (spec/ui/mobile/screens.md:33).
 *
 * Replaces the documents half of the deleted `documents-reports.tsx`; reports
 * stay web-only and do not return to mobile (screens.md:59).
 *
 * TODO-DESIGN: pre-registered by S2 (#957); the library and its s21 upload
 * sheet land with cluster C4.
 */
export default function DocumentsScreen() {
  return (
    <ScreenShell
      title="Documents"
      subtitle="Chapter document library."
    >
      <InfoCard
        title="Not built yet"
        body="This route is pre-registered so later slices can add the screen without reopening the frozen tab layout."
        badge="C4"
      />
    </ScreenShell>
  );
}
