/**
 * A structural type for the slice of `@stripe/stripe-react-native` this app
 * touches, rather than `typeof import("@stripe/stripe-react-native")`.
 *
 * The `typeof import(...)` form puts the package in Metro's dependency graph
 * from a *type* position, which defeats the platform split in
 * `stripe-module.ts` — the web bundle would pull it back in. Declaring the
 * surface by hand keeps the package out of every graph but the native one.
 *
 * It is deliberately tiny: three calls, and the error shape they return. If a
 * fourth is ever needed, add it here rather than widening to the real module
 * type.
 */
export type StripeError = { code?: string; message: string };

export type StripeModule = {
  initStripe(options: { publishableKey: string }): Promise<unknown>;
  initPaymentSheet(options: {
    merchantDisplayName: string;
    paymentIntentClientSecret: string;
  }): Promise<{ error?: StripeError }>;
  presentPaymentSheet(): Promise<{ error?: StripeError }>;
};
