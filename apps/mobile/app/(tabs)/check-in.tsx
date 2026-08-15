import { InfoCard, ScreenShell } from "@/components/screen-shell";

/**
 * s18 — QR check-in scanner (spec/ui/mobile/screens.md:39).
 *
 * TODO-DESIGN: pre-registered by S2 (#957); the scanner lands with cluster C2,
 * which also adds the rotating-token mint/validate API slice the loop needs.
 */
export default function CheckInScreen() {
  return (
    <ScreenShell title="Check in" subtitle="Scan the event code.">
      <InfoCard
        title="Not built yet"
        body="This route is pre-registered so later slices can add the screen without reopening the frozen tab layout."
        badge="C2"
      />
    </ScreenShell>
  );
}
