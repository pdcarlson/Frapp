import { useSyncExternalStore } from "react";
import {
  nativeAppForOrigin,
  phonePlatform,
  PRODUCTION_NATIVE_APP,
  type NativeApp,
  type NativePlatform,
} from "@repo/validation";

const noSubscribe = () => () => {};

/**
 * The phone this browser runs on (`phonePlatform`), or null on a tablet, a
 * desktop, the server and through hydration. A user agent doesn't change
 * while a page is open, so nothing is subscribed.
 */
export function usePhonePlatform(): NativePlatform | null {
  return useSyncExternalStore(
    noSubscribe,
    () => phonePlatform(navigator.userAgent),
    () => null,
  );
}

/**
 * The app this dashboard's environment hands off to (`nativeAppForOrigin`):
 * the store app on `app.frapp.live`, the staging app everywhere else. The
 * store app on the server and through hydration, which draws no hand-off
 * anyway: every caller waits for {@link usePhonePlatform} first.
 */
export function useNativeApp(): NativeApp {
  return useSyncExternalStore(
    noSubscribe,
    () => nativeAppForOrigin(window.location.origin),
    () => PRODUCTION_NATIVE_APP,
  );
}
