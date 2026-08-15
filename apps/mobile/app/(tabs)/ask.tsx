import { InfoCard, ScreenShell } from "@/components/screen-shell";

/**
 * s17 — Ask (spec/ui/mobile/screens.md:38).
 *
 * Reached from the global sparkle pill on s04/s06, never as a fifth tab
 * (spec/ui/mobile/navigation.md:44).
 *
 * TODO-DESIGN: pre-registered by S2 (#957); the sheet presentation and answer
 * behavior land with cluster C7 behind its feature flag, against a mocked
 * corpus — the API has no `ai` module by design.
 */
export default function AskScreen() {
  return (
    <ScreenShell title="Ask" subtitle="Ask about your chapter.">
      <InfoCard
        title="Not built yet"
        body="This route is pre-registered so later slices can add the screen without reopening the frozen tab layout."
        badge="C7"
      />
    </ScreenShell>
  );
}
