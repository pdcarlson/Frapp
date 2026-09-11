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

/**
 * Chat channel/thread rails.
 *
 * These offsets used to encode `top: banner + 5rem` and `max-h: 100vh - 6rem -
 * banner`, sized to clear an `h-16` (64px) header on a page that scrolled the
 * document. The greenfield shell (#2141) changed BOTH premises: the bar is now
 * `h-12`, and scrolling moved into `<main>`, which is itself inside a shell
 * root sized to the viewport minus the banner.
 *
 * So the rails now stick to their own scroll container, whose top already sits
 * below the bar and whose height already excludes it. Offsetting again would
 * push them 80px down from the content top — a dead gap under the bar — and
 * over-subtract about 96px of rail height, clipping the last channels off the
 * bottom of the list. Both the offset and the banner subtraction are therefore
 * gone: `top-0` and a plain `100%` are correct against the new container.
 */
export const CHAT_RAIL_STICKY_CLASS =
  "md:sticky md:top-0 md:max-h-full md:self-start";

export function focusOfflineBanner(): void {
  const banner = document.getElementById(OFFLINE_BANNER_ID);
  if (banner instanceof HTMLElement) {
    banner.focus();
  }
}
