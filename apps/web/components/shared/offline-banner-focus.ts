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
 * Published on `document.documentElement` while the connection banner is
 * mounted, so the dashboard header can sit *under* it (`sticky top-0` on both
 * would stack them in the same viewport slot — #1746).
 */
export const OFFLINE_BANNER_HEIGHT_VAR = "--offline-banner-height";

/**
 * Dashboard page header offset. Paired with `OFFLINE_BANNER_HEIGHT_VAR` so
 * the sticky header cannot occupy the same `top: 0` slot as the banner.
 */
export const DASHBOARD_HEADER_STICKY_CLASS =
  "sticky top-[var(--offline-banner-height,0px)] z-30";

export function focusOfflineBanner(): void {
  const banner = document.getElementById(OFFLINE_BANNER_ID);
  if (banner instanceof HTMLElement) {
    banner.focus();
  }
}
