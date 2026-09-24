import { Platform } from "react-native";
import { isWebOrExpoGo } from "../expo-go";
import { createIsolatedModule } from "../isolated-module";
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
 * The loader machinery — the cached attempt, the test seam, the warn-and-cache
 * on a load failure — is `lib/isolated-module.ts`, shared with the three other
 * isolation modules. Two things are this module's own: the guard, and the fact
 * that the package is reached through `./stripe-module`, whose native and web
 * halves are separate files because an ordinary lazy `require` is not lazy
 * enough under `expo export --platform web`. The full reasoning is in
 * `stripe-module.ts`, and it is worth reading before "simplifying" this back
 * into one require.
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
 * configured. `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` is the mobile counterpart of
 * `apps/web`'s `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` and is optional for exactly
 * the same reason: local dev, CI and Expo Go all run without it, and none of them
 * can take a payment anyway.
 *
 * **Only the reason carries over from web — the rendering does not.** Web hides the
 * control; mobile keeps it and disables it with the reason stated. See
 * {@link stripeUnavailableReason} and the §5 rule below.
 *
 * This matters because it already went wrong once: this comment used to put web's
 * "no Pay affordance renders" beside the claim of sameness, and
 * `apps/mobile/store/README.md` § Review notes copied it into the App Review notes as
 * "the Pay affordance does not render in any build". Nothing has been submitted, so it
 * reached no live listing — but it would have told a reviewer to hunt for an absent
 * control while a disabled one sat on screen. State mobile's behavior here and let
 * `ENV_REFERENCE.md` own web's.
 */
const stripeModule = createIsolatedModule<StripeModule>({
  packageName: "@stripe/stripe-react-native",
  whenUnavailable: "the dues pay path stays disabled.",
  load: requireStripe,
  isUnavailable: isWebOrExpoGo,
});

/**
 * Test-only seam: vitest executes the real CJS `require`, which `vi.mock`
 * cannot intercept, so specs inject a loader instead.
 */
export const setStripeLoaderForTests = stripeModule.setLoaderForTests;

const loadStripe = stripeModule.load;

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
