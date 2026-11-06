import type { GoogleSignInModule } from "./google-auth-types";

/** iOS/Android half of the loader split — see `google-auth-module.ts`. */
export function requireGoogleSignIn(): GoogleSignInModule | null {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("@react-native-google-signin/google-signin") as GoogleSignInModule;
}
