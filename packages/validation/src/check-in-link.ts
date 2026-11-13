import {
  NATIVE_APP_ID,
  NATIVE_APP_SCHEME,
  type NativePlatform,
} from "./native-app";

/**
 * The check-in QR is a link (2026-11-13).
 *
 * It used to carry `frapp-checkin:v1:<event>:<token>`, which only Frapp's own
 * scanner could read, so a member had to open the app, find the event and tap
 * Scan before pointing anything at the screen. Now the code is an ordinary
 * `https://app.frapp.live/check-in?event=…&t=…` link, the way Venmo and Cash App
 * codes are: the phone's own camera reads it, and tapping the banner opens the
 * app straight into checking in (a universal link on iOS, an App Link on
 * Android). On a phone without the app, or one whose build does not claim the
 * path yet, the same address is a web page that checks in from the browser or
 * offers the app (`apps/web/app/check-in`).
 *
 * One home for the shape, because three workspaces meet on it: the API mints
 * it (`apps/api/src/domain/utils/check-in-token.ts`), the app reads it from its
 * route's params, and the web page reads it from its search params.
 */

/** The path the app claims and the web serves. Listed in `APP_LINK_PATHS`. */
export const CHECK_IN_LINK_PATH = "/check-in";

/** The search parameters the link carries. Short: they go into a QR code. */
export const CHECK_IN_LINK_EVENT_PARAM = "event";
export const CHECK_IN_LINK_TOKEN_PARAM = "t";

/** What a check-in link names. */
export interface CheckInLinkTarget {
  eventId: string;
  token: string;
}

/**
 * The link a host screen shows, on the dashboard origin the API is configured
 * with (`APP_URL`).
 *
 * Both values are URL-safe already (a uuid and a base64url signature), but
 * encoded anyway so a future token format cannot break the link.
 */
export function checkInLinkUrl(
  origin: string,
  eventId: string,
  token: string,
): string {
  const base = origin.trim().replace(/\/+$/, "");
  return (
    `${base}${CHECK_IN_LINK_PATH}` +
    `?${CHECK_IN_LINK_EVENT_PARAM}=${encodeURIComponent(eventId)}` +
    `&${CHECK_IN_LINK_TOKEN_PARAM}=${encodeURIComponent(token)}`
  );
}

/**
 * The target from a route's or a page's own parameters (expo-router hands a
 * repeated parameter over as an array; the first one counts), or null when
 * either is missing or blank.
 */
export function checkInTargetFrom(
  event: string | string[] | null | undefined,
  token: string | string[] | null | undefined,
): CheckInLinkTarget | null {
  const eventId = (Array.isArray(event) ? event[0] : event)?.trim();
  const value = (Array.isArray(token) ? token[0] : token)?.trim();
  if (!eventId || !value) return null;
  return { eventId, token: value };
}

/**
 * The link that opens a check-in in the installed app from the web page, for
 * a build whose binary does not claim the https path yet: the app's own
 * scheme on iOS, Chrome's `intent:` form on Android (which opens Play when the
 * app is missing). Same shape as the invite's `openInAppUrl`.
 */
export function openCheckInInAppUrl(
  platform: NativePlatform,
  target: CheckInLinkTarget,
): string {
  const route =
    `check-in?${CHECK_IN_LINK_EVENT_PARAM}=${encodeURIComponent(target.eventId)}` +
    `&${CHECK_IN_LINK_TOKEN_PARAM}=${encodeURIComponent(target.token)}`;
  if (platform === "android") {
    return `intent://${route}#Intent;scheme=${NATIVE_APP_SCHEME};package=${NATIVE_APP_ID};end`;
  }
  return `${NATIVE_APP_SCHEME}://${route}`;
}
