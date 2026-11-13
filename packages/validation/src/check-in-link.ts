import { PRODUCTION_APP_ORIGIN } from "./invite-token";
import { appUrl, type NativePlatform } from "./native-app";

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
 * route's params or from the code its own Scan code reads
 * ({@link parseCheckInLink}), and the web page reads it from its search params.
 */

/** The path the app claims and the web serves. Listed in `APP_LINK_PATHS`. */
export const CHECK_IN_LINK_PATH = "/check-in";

/** The search parameters the link carries. Short: they go into a QR code. */
export const CHECK_IN_LINK_EVENT_PARAM = "event";
export const CHECK_IN_LINK_TOKEN_PARAM = "t";

/**
 * The API's refusal of a scanned or typed code: stale, screenshotted, or
 * another event's (`AttendanceService.checkIn`). It carries no error code, so
 * the sentence identifies it; mobile's `check-in-outcome.spec.ts` reads it from
 * the API's source so the two can't drift apart in silence.
 */
export const CHECK_IN_CODE_REFUSED_MESSAGE =
  "That check-in code is not valid for this event, or it has expired";

/**
 * The API's two refusals of a check-in that carried no location: near the
 * officer's screen (#4532) and inside a drawn zone. Pinned to the API's source
 * the same way.
 */
export const CHECK_IN_NEEDS_LOCATION_MESSAGES: readonly string[] = [
  "This check-in needs your location. Allow location for Frapp and scan again.",
  "This event checks you in by location — use the Frapp mobile app to check in.",
];

/**
 * What the app and the web page say when a scanned link's code was refused:
 * by the time it reached the server it had rotated out (the shared error
 * copy's "ask the host for the current one" is for a typed code).
 */
export const CHECK_IN_CODE_CHANGED_COPY =
  "That code has changed since you scanned it. Point your camera at the screen again.";

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
 * The event and token a scanned code names, or null for any other text: a
 * link on one of `origins` (the caller's dashboard origin) to the check-in
 * path with both parameters. The app's Scan code reads the same code the
 * phone's camera opens, so a code that isn't one of these (a poster, a menu,
 * another app's link) is not a check-in.
 */
export function parseCheckInLink(
  raw: string,
  origins: readonly string[] = [PRODUCTION_APP_ORIGIN],
): CheckInLinkTarget | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  const allowed = origins.map((origin) => {
    try {
      return new URL(origin).origin;
    } catch {
      return null;
    }
  });
  if (!allowed.includes(url.origin)) return null;
  if (url.pathname.replace(/\/+$/, "") !== CHECK_IN_LINK_PATH) return null;
  return checkInTargetFrom(
    url.searchParams.get(CHECK_IN_LINK_EVENT_PARAM),
    url.searchParams.get(CHECK_IN_LINK_TOKEN_PARAM),
  );
}

/**
 * The link that opens a check-in in the installed app from the web page, for
 * a build whose binary does not claim the https path yet: the app's own
 * scheme on iOS, Chrome's `intent:` form on Android (which opens Play when the
 * app is missing), through the one `appUrl` the invite's `openInAppUrl` uses.
 */
export function openCheckInInAppUrl(
  platform: NativePlatform,
  target: CheckInLinkTarget,
): string {
  return appUrl(
    platform,
    `check-in?${CHECK_IN_LINK_EVENT_PARAM}=${encodeURIComponent(target.eventId)}` +
      `&${CHECK_IN_LINK_TOKEN_PARAM}=${encodeURIComponent(target.token)}`,
  );
}
