import type { StripeModule } from "./stripe-types";

/**
 * The **web / default** half of the Stripe loader split. It contains no
 * `require` of the package at all, and that absence is the entire point.
 *
 * `npx expo export --platform web` statically renders every screen in a Node
 * environment, and under that transform Metro does not keep a `require()`
 * lazy — the package is evaluated when the module holding it loads. Stripe's
 * entry reaches `TurboModuleRegistry` with no bridge and the export dies with
 * "Invariant Violation: __fbBatchedBridgeConfig is not set", *before* any
 * runtime guard can run and outside the reach of a `try/catch`.
 *
 * A platform split is the only fix that keeps both halves true: the native
 * bundle still contains the package (a dynamic specifier would leave it out of
 * the app entirely), and the web/SSR bundle never mentions it. Metro resolves
 * `./stripe-module` to `stripe-module.native.ts` on iOS and Android and to this
 * file everywhere else.
 *
 * `react-native-keyboard-controller` survives an ordinary lazy require in
 * `lib/keyboard.tsx` only because its entry does not touch a native module at
 * import time. That is a property of that package, not a pattern to copy.
 */
export function requireStripe(): StripeModule | null {
  return null;
}
