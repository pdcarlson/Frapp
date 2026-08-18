import type { NotificationsModule } from "./push-types";

/**
 * The **web / default** half of the `expo-notifications` loader split. It
 * contains no `require` of the package at all, and that absence is the entire
 * point.
 *
 * `npx expo export --platform web` statically renders every screen under Node.
 * Under that transform Metro evaluates a required package when the module
 * holding the `require` *loads*, not when the function containing it *runs* —
 * so a lazy require in `push.ts` would be evaluated during the export, reach
 * `TurboModuleRegistry` with no bridge, and abort with
 * `Invariant Violation: __fbBatchedBridgeConfig is not set` before any runtime
 * guard could return null, and outside the reach of the `try/catch` written for
 * exactly this.
 *
 * A platform split is the only fix that keeps both halves true: the native
 * bundle still contains the package (a dynamic specifier would leave it out of
 * the app entirely), and the web/SSR bundle never mentions it. Metro resolves
 * `./push-module` to `push-module.native.ts` on iOS and Android and to this file
 * everywhere else.
 *
 * `react-native-keyboard-controller` survives an ordinary lazy require in
 * `lib/keyboard.tsx` only because its entry does not touch a native module at
 * import time. That is a property of that package, not a pattern to copy —
 * `@stripe/stripe-react-native` needed this same split, and so does this one.
 */
export function requireNotifications(): NotificationsModule | null {
  return null;
}
