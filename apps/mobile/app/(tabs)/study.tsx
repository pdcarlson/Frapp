import { InfoCard, ScreenShell } from "@/components/screen-shell";

/**
 * s10 — Study hours (spec/ui/mobile/screens.md:31).
 *
 * TODO-DESIGN: pre-registered by S2 (#957) so the hotspot freeze holds; the
 * study-session timer and its geofencing land with cluster C5.
 */
export default function StudyScreen() {
  return (
    <ScreenShell
      title="Study hours"
      subtitle="Study-session timer and geofenced check-in."
    >
      <InfoCard
        title="Not built yet"
        body="This route is pre-registered so later slices can add the screen without reopening the frozen tab layout."
        badge="C5"
      />
    </ScreenShell>
  );
}
