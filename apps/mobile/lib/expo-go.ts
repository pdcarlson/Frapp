import { Platform } from "react-native";
import Constants, { ExecutionEnvironment } from "expo-constants";

/**
 * Is the app running inside Expo Go?
 *
 * Three isolation modules gate on this: `lib/keyboard.tsx` calls it directly,
 * and `lib/notifications/push.ts` and `lib/payments/stripe.ts` reach it through
 * `isWebOrExpoGo` below. Go ships neither the keyboard controller, remote push,
 * nor Stripe's native module, so the package must never be required there —
 * that is the crash-prevention property, not merely a reported unavailability.
 *
 * Read inside the function rather than at module scope so a spec can mock
 * `expo-constants` without import-order sensitivity.
 *
 * Kept out of `lib/isolated-module.ts` so the loader factory stays
 * import-free: `lib/apple-auth.ts` guards on `Platform.OS` and must not pull
 * `expo-constants` — and through it `react-native`'s `NativeModules` — in
 * behind the factory.
 */
export function isExpoGo(): boolean {
  return Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
}

/**
 * No native target here: the web/SSR bundle, or Expo Go.
 *
 * The guard `lib/notifications/push.ts` and `lib/payments/stripe.ts` share.
 * For loading, the web clause is belt and braces on both: their `*-module.ts`
 * half already returns `null` there, so it cannot be the thing that saves the
 * export. It makes the intent legible at the one place a reader looks, and it
 * is simply true — neither remote push nor Stripe's native sheet has a web
 * target. It is **not** redundant for the reason sentence, though:
 * `pushUnavailableReason()` reads this guard to tell "no native target" apart
 * from a native module that threw in an installed build, which caches the
 * same `null`, so dropping the web clause would tell a web visitor to update
 * the app. `push.spec.ts` pins the web sentence.
 *
 * One predicate rather than two, because this one is genuinely shared: if what
 * counts as "no native target" ever changes, it must change for both, and a
 * hand-copy is how it would change for only one. The other two isolation
 * modules keep their own guards, which are genuinely different
 * (`lib/keyboard.tsx` is Expo Go alone; `lib/apple-auth.ts` is
 * `Platform.OS !== "ios"`).
 */
export function isWebOrExpoGo(): boolean {
  return Platform.OS === "web" || isExpoGo();
}
