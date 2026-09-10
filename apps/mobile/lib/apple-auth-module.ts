import type { AppleAuthModule } from "./apple-auth-types";

/**
 * Web / default half of the Apple Authentication loader split.
 *
 * Same reason as `payments/stripe-module.ts`: `expo export --platform web`
 * evaluates a `require("expo-apple-authentication")` at bundle time, and that
 * package touches native modules. This file never mentions the package.
 */
export function requireAppleAuth(): AppleAuthModule | null {
  return null;
}
