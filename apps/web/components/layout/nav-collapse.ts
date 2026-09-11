/**
 * Persistence for the left nav's collapsed/expanded state.
 *
 * The board (option `1c`, pin 2) calls the collapse state a remembered user
 * preference, and the first-paint contract (`1s`) budgets zero layout shift
 * above the fold. Those two together rule out reading the preference from
 * `localStorage` in an effect: the server would render 220px, the client would
 * correct to 56px after hydration, and every route would open with a visible
 * jump of the entire content column.
 *
 * So it is a cookie. The dashboard layout is already an async server component,
 * so it can read the value and hand the shell its initial state, and the markup
 * is correct on the very first paint.
 *
 * Not `httpOnly`: the toggle is a client control and writes this itself. It
 * carries no identity and gates no access, so a readable cookie costs nothing.
 */

export const NAV_COLLAPSED_COOKIE = "signet_nav_collapsed";

/** A year. The preference should outlive a session without being permanent. */
export const NAV_COLLAPSED_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * Parse the cookie value into a boolean.
 *
 * Anything other than the literal `"1"` is expanded — an absent cookie, a
 * cleared one, or a value some other tool wrote. Expanded is the right default
 * because it is the state that shows the member what the product contains.
 */
export function parseNavCollapsed(value: string | undefined): boolean {
  return value === "1";
}

/**
 * Write the preference from the client.
 *
 * `SameSite=Lax` because this is a same-site preference with no cross-site
 * meaning, and `Secure` only off localhost so a dev server over plain HTTP can
 * still set it.
 */
export function persistNavCollapsed(collapsed: boolean): void {
  if (typeof document === "undefined") return;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie =
    `${NAV_COLLAPSED_COOKIE}=${collapsed ? "1" : "0"}` +
    `; Path=/; Max-Age=${NAV_COLLAPSED_MAX_AGE}; SameSite=Lax${secure}`;
}
