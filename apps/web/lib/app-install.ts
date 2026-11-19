import {
  PRODUCTION_NATIVE_APP,
  STORE_LISTING_URLS,
  type NativeApp,
  type NativePlatform,
} from "@repo/validation";
import { useNativeApp } from "@/lib/use-phone-platform";

/**
 * Where a phone gets this environment's app (2026-11-19): the one link every
 * "Get the app" button on the web follows, on the invite hand-off, the phone
 * dashboard's Get the app card and the check-in page.
 *
 * During the beta the apps aren't on the stores' public listings. The iPhone
 * app comes from a TestFlight external group's public link, which anyone can
 * open without being added by Apple ID, and the Android app from Play's tester
 * page. Those links are made in App Store Connect and Play Console, one per
 * app, so they come from the environment like the app-link values beside them
 * (`lib/app-links.ts`): `NEXT_PUBLIC_IOS_INSTALL_URL` and
 * `NEXT_PUBLIC_ANDROID_INSTALL_URL`, set in Infisical `staging` for Frapp
 * Staging and in `prod` for the store app (`ENV_REFERENCE.md`). Both are
 * public, inlined at build, so a changed value reaches the page at the next
 * web deploy.
 *
 * Unset, the store app falls back to its store listing, and the staging app,
 * which has no listing, offers no install button.
 */
export function appInstallUrl(
  platform: NativePlatform,
  app: NativeApp,
  configured: Readonly<Record<NativePlatform, string | undefined>>,
): string | null {
  const url = validInstallUrl(configured[platform]);
  if (url) return url;
  return app.id === PRODUCTION_NATIVE_APP.id
    ? STORE_LISTING_URLS[platform]
    : null;
}

/** An https URL, or null: a malformed value draws no button rather than a dead one. */
function validInstallUrl(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Where an install link leads, so the button can say what happens next. */
export type InstallSource = "testflight" | "play-testing" | "store";

export function installSource(url: string): InstallSource {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "store";
  }
  if (parsed.host === "testflight.apple.com") return "testflight";
  if (
    parsed.host === "play.google.com" &&
    /^\/apps\/(internaltest|testing)\b/.test(parsed.pathname)
  ) {
    return "play-testing";
  }
  return "store";
}

/**
 * The configured links. Each `process.env.NEXT_PUBLIC_*` is written out in
 * full so Next inlines it into the client bundle.
 */
function configuredInstallUrls(): Record<NativePlatform, string | undefined> {
  return {
    ios: process.env.NEXT_PUBLIC_IOS_INSTALL_URL,
    android: process.env.NEXT_PUBLIC_ANDROID_INSTALL_URL,
  };
}

/**
 * This dashboard's app and the link that installs it on `platform` (none off
 * a phone).
 */
export function useAppInstall(platform: NativePlatform | null): {
  app: NativeApp;
  installUrl: string | null;
} {
  const app = useNativeApp();
  return {
    app,
    installUrl:
      platform === null
        ? null
        : appInstallUrl(platform, app, configuredInstallUrls()),
  };
}
