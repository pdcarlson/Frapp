import { useSyncExternalStore } from "react";
import { phonePlatform, type NativePlatform } from "@repo/validation";

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
