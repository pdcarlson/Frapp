import { loadStripe, type Stripe } from "@stripe/stripe-js";

/**
 * Stripe.js loader for the member-facing pay flow.
 *
 * The publishable key is intentionally **optional**. It is absent in local dev,
 * in CI, and during the production `next build` prerender, and a missing key
 * must never throw — `loadStripe(undefined)` does, which would take the whole
 * billing route down rather than just hiding a button. So the key is read
 * defensively and every caller is expected to treat `null` as "payments are not
 * configured here", degrading to no pay affordance at all.
 */
let stripePromise: Promise<Stripe | null> | null = null;

export function getStripePublishableKey(): string | null {
  const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  return key && key.trim().length > 0 ? key : null;
}

export function isStripeConfigured(): boolean {
  return getStripePublishableKey() !== null;
}

/**
 * Returns the memoized Stripe.js instance, or `null` when unconfigured.
 * Memoized because `loadStripe` injects a <script> tag — calling it per render
 * would add one per mount.
 */
export function getStripe(): Promise<Stripe | null> | null {
  const key = getStripePublishableKey();
  if (!key) return null;
  stripePromise ??= loadStripe(key);
  return stripePromise;
}
