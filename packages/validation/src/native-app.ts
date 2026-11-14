/**
 * Where the native app lives, and how a web page sends someone to it (#4002):
 * an invite link's hand-off on web `/join`, and the phone dashboard's Get the
 * app card.
 *
 * The identifiers are permanent (`spec/ui/brand-identity.md`): the iOS bundle id
 * and the Android package are both `live.frapp.mobile`, the scheme is `frapp://`,
 * and the App Store id is App Store Connect's Apple ID for the app
 * (`apps/mobile/eas.json` → `submit.production.ios.ascAppId`). One home, so the
 * web's invite hand-off (`apps/web/components/auth/app-handoff.tsx`), its Get
 * the app card (`apps/web/components/layout/get-the-app-card.tsx`), the API's
 * update screen default and the app-link files can't name different apps.
 */

export const NATIVE_APP_ID = "live.frapp.mobile";
export const NATIVE_APP_SCHEME = "frapp";
export const APP_STORE_APP_ID = "6812025642";

export type NativePlatform = "ios" | "android";

/**
 * The store listings. During the beta the iOS app is on TestFlight and the
 * Android app on Play's internal track, so these open for testers only until
 * each store lists the app publicly.
 */
export const STORE_LISTING_URLS: Readonly<Record<NativePlatform, string>> = {
  ios: `https://apps.apple.com/app/id${APP_STORE_APP_ID}`,
  android: `https://play.google.com/store/apps/details?id=${NATIVE_APP_ID}`,
};

/**
 * The paths on the dashboard origin the app claims as universal links (iOS)
 * and App Links (Android): the invite, and the event check-in code a phone's
 * camera reads (`./check-in-link`, 2026-11-13). Every other dashboard page
 * stays on the web (the phone dashboard suggests the app with a card it can
 * close). The web's `/.well-known` files publish these. iOS takes its paths
 * from the web's file, so a path added here reaches every iOS build with
 * `applinks:app.frapp.live` (0.11.0 on) at the next web deploy: add one only
 * once the installed builds have its route, or they open it on Chat home.
 * Android claims each path in `apps/mobile/app.json`'s `intentFilters`, which
 * is native, so a new Android path waits on the next native version
 * (`app.config.spec.ts` lists the ones waiting). A message's link (`/chat`,
 * `./message-link`) waits on both (#4869).
 */
export const APP_LINK_PATHS = ["/join", "/check-in"] as const;

/**
 * The search parameters of `raw` when it is a link to `path` on one of
 * `origins` (a caller's dashboard origin), or null for any other text. The one
 * matcher behind every app-link parser (`./check-in-link`, `./message-link`),
 * so they agree on which links are the app's own.
 */
export function appLinkParams(
  raw: string,
  origins: readonly string[],
  path: string,
): URLSearchParams | null {
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
  if (url.pathname.replace(/\/+$/, "") !== path) return null;
  return url.searchParams;
}

/**
 * The phone a user agent belongs to, or null for anything else.
 *
 * Phones only. An iPad's Safari reports itself as a Mac, and an Android tablet
 * leaves `Mobile` out of its user agent, and both get the web as before. So
 * does every desktop.
 */
export function phonePlatform(
  userAgent: string | null | undefined,
): NativePlatform | null {
  if (typeof userAgent !== "string") return null;
  if (/\b(iPhone|iPod)\b/.test(userAgent)) return "ios";
  if (/\bAndroid\b/.test(userAgent) && /\bMobile\b/.test(userAgent)) {
    return "android";
  }
  return null;
}

/**
 * The link that opens an invite in the installed app.
 *
 * iOS opens the app's own scheme, which the app routes to its join step
 * (`spec/ui/mobile/navigation.md`). With no app installed Safari refuses it, so
 * the page that offers it also offers the store.
 *
 * Android uses Chrome's `intent:` form with the package named: with the app
 * installed it opens the same `frapp://join` route, and without it Chrome
 * opens the app's Play listing instead of failing.
 */
export function openInAppUrl(platform: NativePlatform, token: string): string {
  return appUrl(platform, `join?token=${encodeURIComponent(token)}`);
}

/**
 * The one shape of a link into the app: `frapp://<route>` on iOS, Chrome's
 * `intent:` form naming the package on Android.
 */
export function appUrl(platform: NativePlatform, route: string): string {
  if (platform === "android") {
    return `intent://${route}#Intent;scheme=${NATIVE_APP_SCHEME};package=${NATIVE_APP_ID};end`;
  }
  return `${NATIVE_APP_SCHEME}://${route}`;
}

/**
 * The link that opens the installed app at its home, with no invite: the
 * phone dashboard's Get the app card. Android's `intent:` form opens Play when
 * the app is missing; iOS's scheme is refused without it, so the card offers
 * the store beside it.
 */
export function openAppUrl(platform: NativePlatform): string {
  return appUrl(platform, "");
}

/**
 * The query mark the app adds to a dashboard page it opens in its in-app
 * browser (the setup list's web-only steps). That browser has a phone's user
 * agent, so without it the dashboard would tell someone already using the app
 * to get it.
 */
export const OPENED_FROM_APP_KEY = "from";
export const OPENED_FROM_APP_VALUE = "app";
