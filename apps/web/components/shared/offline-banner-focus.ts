/**
 * Stable id so `useGatedDialog` can send keyboard focus here when a dialog
 * closes onto a now-disabled trigger (`spec/ui/resilience.md` § 2 / #1753).
 *
 * Lives in its own module so `subscription-gate` does not import
 * `offline-banner.tsx` (which reads `useNetwork`) — a spec that mocks
 * `network-provider` would otherwise initialize that mock while the
 * factory's `networkMock` import was still unbound.
 */
export const OFFLINE_BANNER_ID = "frapp-offline-banner";

export function focusOfflineBanner(): void {
  const banner = document.getElementById(OFFLINE_BANNER_ID);
  if (banner instanceof HTMLElement) {
    banner.focus();
  }
}
