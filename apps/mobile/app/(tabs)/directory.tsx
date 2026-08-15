import { InfoCard, ScreenShell } from "@/components/screen-shell";

/**
 * s13 — Directory (spec/ui/mobile/screens.md:34).
 *
 * TODO-DESIGN: pre-registered by S2 (#957); actives + alumni search lands with
 * cluster C4 per spec/behavior/members.md.
 */
export default function DirectoryScreen() {
  return (
    <ScreenShell title="Directory" subtitle="Actives and alumni.">
      <InfoCard
        title="Not built yet"
        body="This route is pre-registered so later slices can add the screen without reopening the frozen tab layout."
        badge="C4"
      />
    </ScreenShell>
  );
}
