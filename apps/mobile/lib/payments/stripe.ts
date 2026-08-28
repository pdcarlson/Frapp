import { Platform } from "react-native";
import Constants, { ExecutionEnvironment } from "expo-constants";
import { requireStripe } from "./stripe-module";
import type { StripeModule } from "./stripe-types";

/**
 * Isolation module for `@stripe/stripe-react-native`
 * (`spec/ui/mobile/README.md` § Expo Go, `patterns.md` § Dues payment).
 *
 * The package links a native module at import time and Expo Go does not ship
 * it, so an unguarded import crashes Go at launch. Nothing outside this file may
 * import the package — ESLint `no-restricted-imports` has enforced that since S1
 * and names this path in its message. Everything else goes through
 * `isStripeAvailable()` and the two calls below.
 *
 * Modelled on `lib/keyboard.tsx`, which solved the same problem for
 * `react-native-keyboard-controller` — the guard read inside the function
 * rather than at module scope, and the test seam, come from there. One thing
 * does **not** carry over: the package is reached through `./stripe-module`,
 * whose native and web halves are separate files, because an ordinary lazy
 * `require` is not lazy enough under `expo export --platform web`. The full
 * reasoning is in `stripe-module.ts`, and it is worth reading before
 * "simplifying" this back into one require.
 *
 * ## No Apple Pay or Google Pay, and no config plugin
 *
 * `initPaymentSheet` is called with a PaymentIntent and nothing else, so the
 * sheet offers cards only. The package's Expo config plugin is deliberately
 * **not** in `app.json`: it exists to write the Apple Pay merchant entitlement
 * and the Google Pay flag, it throws without a `merchantIdentifier`, and that
 * identifier has to be registered in a real Apple Developer account — so adding
 * one here would be inventing configuration that does not exist. The native
 * module autolinks without it. Wallet support is a separate, human-gated change.
 *
 * ## Two things have to be true before a Pay button does anything
 *
 * The native module has to exist **and** a publishable key has to be
 * configured. `apps/web` already draws that line — `ENV_REFERENCE.md` records
 * that when `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` is unset "`getStripe()` returns
 * `null` and no Pay affordance renders". `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` is
 * the mobile counterpart and is optional for exactly the same reason: local dev,
 * CI and Expo Go all run without it, and none of them can take a payment anyway.
 */
/** `undefined` = not yet attempted; `null` = attempted and unavailable. */
let cachedModule: StripeModule | null | undefined;

const defaultLoader = (): StripeModule | null => requireStripe();

let loader = defaultLoader;

/**
 * Test-only seam: vitest executes the real CJS `require`, which `vi.mock`
 * cannot intercept, so specs inject a loader instead.
 */
export function setStripeLoaderForTests(
  next: (() => StripeModule | null) | null,
) {
  loader = next ?? defaultLoader;
  cachedModule = undefined;
}

function loadStripe(): StripeModule | null {
  if (cachedModule !== undefined) return cachedModule;

  // Belt and braces. `stripe-module.ts` already returns null on web, so this
  // cannot be the thing that saves the export — but it makes the intent legible
  // at the one place a reader looks, and it is simply true: Stripe's native
  // sheet has no web target.
  if (Platform.OS === "web") {
    cachedModule = null;
    return cachedModule;
  }

  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) {
    cachedModule = null;
    return cachedModule;
  }

  try {
    cachedModule = loader();
  } catch (error) {
    // Outside Expo Go the module is expected to exist, so a load failure is a
    // real linking problem (a dev client built before this package landed), not
    // the Go fallback wearing its clothes.
    console.warn(
      "@stripe/stripe-react-native failed to load; the dues pay path stays disabled.",
      error,
    );
    cachedModule = null;
  }

  return cachedModule;
}

export function publishableKey(): string | null {
  const key = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  return typeof key === "string" && key.length > 0 ? key : null;
}

/**
 * Whether this build can actually take a payment.
 *
 * The name comes from `patterns.md` § Dues payment, which requires "the whole
 * payment path" to sit behind it. It folds in the key check, because a member
 * cannot tell a missing native module from a missing key and neither one lets
 * them pay.
 */
export function isStripeAvailable(): boolean {
  return loadStripe() !== null && publishableKey() !== null;
}

/**
 * Why payment is unavailable, or `null` when it is available.
 *
 * §5's rule for a disabled control is that it names the blocker — "A disabled
 * control with no explanation is its own dead end." The two causes need
 * different sentences: one is fixed by installing a real build, the other is a
 * chapter/deployment configuration the member cannot do anything about.
 */
export function stripeUnavailableReason(): string | null {
  if (loadStripe() === null) {
    if (Platform.OS === "web") {
      return "Paying dues is available in the Frapp mobile app.";
    }
    return "Paying in the app needs the installed Frapp build — Expo Go can't open the payment sheet. Your treasurer can still take payment another way.";
  }
  if (publishableKey() === null) {
    return "Card payments aren't switched on for this build yet. Ask your treasurer how to pay this invoice.";
  }
  return null;
}

export type PaymentSheetOutcome =
  | { kind: "completed" }
  | { kind: "canceled" }
  | { kind: "failed"; message: string };

/**
 * Present the PaymentSheet for an already-minted PaymentIntent.
 *
 * Returns an outcome rather than throwing, because "the member closed the
 * sheet" is not an error and must not be rendered as one. A genuine failure
 * carries the provider's own message, which is the only party that knows why a
 * card was declined.
 *
 * **Completing here means the money moved, not that the invoice settled.**
 * `spec/behavior/billing.md`: only the `payment_intent.succeeded` webhook writes
 * PAID. The caller re-reads until the server agrees — never write it locally.
 */
export async function presentPaymentSheet(input: {
  clientSecret: string;
  merchantDisplayName: string;
}): Promise<PaymentSheetOutcome> {
  const stripe = loadStripe();
  const key = publishableKey();
  if (!stripe || !key) {
    return {
      kind: "failed",
      message:
        stripeUnavailableReason() ?? "Card payments aren't available here.",
    };
  }

  await stripe.initStripe({ publishableKey: key });

  const init = await stripe.initPaymentSheet({
    merchantDisplayName: input.merchantDisplayName,
    paymentIntentClientSecret: input.clientSecret,
  });
  if (init.error) {
    return { kind: "failed", message: init.error.message };
  }

  const result = await stripe.presentPaymentSheet();
  if (result.error) {
    // Stripe reports a dismissed sheet as an error with the `Canceled` code.
    // Treating it as a failure would put a red line under a member who simply
    // changed their mind.
    if (result.error.code === "Canceled") return { kind: "canceled" };
    return { kind: "failed", message: result.error.message };
  }

  return { kind: "completed" };
}
