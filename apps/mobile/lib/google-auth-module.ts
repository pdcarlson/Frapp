import type { GoogleSignInModule } from "./google-auth-types";

/**
 * Web / default half of the Google Sign-In loader split.
 *
 * Same reason as `apple-auth-module.ts`: `expo export --platform web` would
 * evaluate a `require("@react-native-google-signin/google-signin")` at bundle
 * time, and that package reads its native module's constants at import. This
 * file never mentions the package.
 */
export function requireGoogleSignIn(): GoogleSignInModule | null {
  return null;
}
