/**
 * Where the native app lives and how a web page hands an invite to it (#4002).
 *
 * The identifiers are permanent (`spec/ui/brand-identity.md`): the iOS bundle id
 * and the Android package are both `live.frapp.mobile`, the scheme is `frapp://`,
 * and the App Store id is App Store Connect's Apple ID for the app
 * (`apps/mobile/eas.json` → `submit.production.ios.ascAppId`). One home, so the
 * web's "Get the app", the API's update screen default and the app-link files
 * can't name different apps.
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
 * and App Links (Android). Only the invite: every other dashboard page is web
 * work an officer does on a desktop. `apps/mobile/app.json` and the web's
 * `/.well-known` files must list the same paths.
 */
export const APP_LINK_PATHS = ["/join"] as const;

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
  const query = `token=${encodeURIComponent(token)}`;
  if (platform === "android") {
    return `intent://join?${query}#Intent;scheme=${NATIVE_APP_SCHEME};package=${NATIVE_APP_ID};end`;
  }
  return `${NATIVE_APP_SCHEME}://join?${query}`;
}
