import { InfoCard, ScreenShell } from "@/components/screen-shell";

/**
 * s11 — Dues (spec/ui/mobile/screens.md:32).
 *
 * TODO-DESIGN: pre-registered by S2 (#957); balance, pay and history land with
 * cluster C6, whose PaymentSheet path sits behind a runtime Stripe guard.
 */
export default function DuesScreen() {
  return (
    <ScreenShell title="Dues" subtitle="Balance, payment, and history.">
      <InfoCard
        title="Not built yet"
        body="This route is pre-registered so later slices can add the screen without reopening the frozen tab layout."
        badge="C6"
      />
    </ScreenShell>
  );
}
