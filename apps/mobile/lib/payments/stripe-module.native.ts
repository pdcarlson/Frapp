import type { StripeModule } from "./stripe-types";

/** The iOS/Android half of the loader split — see `stripe-module.ts`. */
export function requireStripe(): StripeModule | null {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("@stripe/stripe-react-native") as StripeModule;
}
