import { Platform } from "react-native";

/**
 * The path to Frapp's location switch in the member's own Settings app. The
 * two lines that send a member there both take it from here: the Start card's
 * failure line, which has no button and so is the whole way forward, and the
 * primer's blocked branch (`spec/ui/design-system/writing.md`
 * § Study session (mobile, s10)).
 *
 * The path depends on the OS, and on iOS on the version, because the wrong one
 * sends the member looking for a row that isn't there:
 *
 * - From iOS 18, every app's page sits under an Apps row in Settings.
 * - Before 18, the app's page is listed on Settings' own root. The app installs
 *   from iOS 16.4, Expo SDK 57's floor (`expo/Expo.podspec`; neither `app.json`
 *   nor `app.config.js` raises it), so both iOS forms ship.
 * - Android puts the switch on the app's Permissions page.
 * - The web build (`expo start --web`, used for demos and store captures) has
 *   no Settings path at all: location there is the site's permission, held by
 *   the browser. So this returns `null`, and each caller says
 *   {@link BROWSER_LOCATION_STEP} instead.
 *
 * Every form names the app as Settings lists it, `expo.name`.
 * `scripts/ci/__tests__/frapp-naming.test.mjs` pins each of the three forms to
 * that name, and holds both callers to this helper (ADR-25 step 2).
 */
export function locationSettingsPath(): string | null {
  // Checked before the iOS branch, which every other OS would fall into:
  // react-native-web's `Platform.Version` is "0.0.0", which reads as iOS 0.
  if (Platform.OS === "web") return null;
  if (Platform.OS === "android") {
    return "Settings → Apps → Frapp → Permissions → Location";
  }
  return iosMajorVersion() >= 18
    ? "Settings → Apps → Frapp → Location"
    : "Settings → Frapp → Location";
}

/**
 * `Platform.Version` is iOS's `systemVersion`, a string such as `"17.5.1"`.
 * One that doesn't parse counts as current, since every iOS from 18 on (Apple
 * went from 18 to 26) has the Apps row.
 */
function iosMajorVersion(): number {
  const major = Number.parseInt(String(Platform.Version), 10);
  return Number.isNaN(major) ? Number.POSITIVE_INFINITY : major;
}

/**
 * The web build's step where native builds name a Settings path, completing
 * "…, then start your session." or ending a sentence.
 */
export const BROWSER_LOCATION_STEP =
  "Allow location for this site in your browser";
