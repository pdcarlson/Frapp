/**
 * Stable id so `useGatedDialog` can send keyboard focus here when a dialog
 * closes onto a now-disabled trigger (`spec/ui/resilience/connection-state.md` / #1753).
 *
 * Lives in its own module so `subscription-gate` does not import
 * `offline-banner.tsx` (which reads `useNetwork`) — a spec that mocks
 * `network-provider` would otherwise initialize that mock while the
 * factory's `networkMock` import was still unbound.
 */
export const OFFLINE_BANNER_ID = "frapp-offline-banner";

/**
 * Set on the dashboard shell's root so the connection banner can float below
 * the 48px top bar instead of over it (#2244). The banner reads it through a
 * CSS `:has()` rule, which Tailwind needs spelled literally in the class
 * string, so this constant is what the specs pin both sides against.
 */
export const DASHBOARD_SHELL_ATTR = "data-dashboard-shell";

export function focusOfflineBanner(): void {
  const banner = document.getElementById(OFFLINE_BANNER_ID);
  if (banner instanceof HTMLElement) {
    banner.focus();
  }
}
