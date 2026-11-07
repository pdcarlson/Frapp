/**
 * Marks the connection pill so `useGatedDialog` can send keyboard focus to it
 * when a dialog closes onto a now-disabled trigger
 * (`spec/ui/resilience/connection-state.md` / #1753).
 *
 * An attribute, not an id: the pill is mounted twice, in the top bar and
 * floating for the routes with no bar, and only one of them is ever drawn
 * (`connection-pill.tsx`). Focus goes to the one that is.
 *
 * Lives in its own module so `subscription-gate` does not import
 * `connection-pill.tsx` (which reads `useNetwork`) — a spec that mocks
 * `network-provider` would otherwise initialize that mock while the
 * factory's `networkMock` import was still unbound.
 */
export const CONNECTION_PILL_ATTR = "data-connection-pill";

/**
 * Set on the dashboard shell's root. The floating pill reads it through a CSS
 * `:has()` rule and stands down, because the top bar carries the pill
 * whenever the shell is mounted. Tailwind needs the attribute spelled
 * literally in the class string, so this constant is what the specs pin both
 * sides against.
 */
export const DASHBOARD_SHELL_ATTR = "data-dashboard-shell";

export function focusConnectionPill(): void {
  const pills = document.querySelectorAll<HTMLElement>(
    `[${CONNECTION_PILL_ATTR}]`,
  );
  for (const pill of pills) {
    // `display: none` (the floating pill inside the shell) has no boxes.
    if (pill.getClientRects().length > 0) {
      pill.focus();
      return;
    }
  }
  // jsdom lays nothing out, so no pill has boxes there: take the first.
  pills[0]?.focus();
}
