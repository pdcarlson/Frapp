import { InfoCard, ScreenShell } from "@/components/screen-shell";

/**
 * s22 — Host check-in, admin (spec/ui/mobile/screens.md:43).
 *
 * TODO-DESIGN: pre-registered by S2 (#957); the rotating QR display and its
 * role gate land with cluster C2.
 */
export default function HostCheckInScreen() {
  return (
    <ScreenShell
      title="Host check-in"
      subtitle="Display the rotating event code."
    >
      <InfoCard
        title="Not built yet"
        body="This route is pre-registered so later slices can add the screen without reopening the frozen tab layout."
        badge="C2"
      />
    </ScreenShell>
  );
}
