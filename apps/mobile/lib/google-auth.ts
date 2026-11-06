import { Platform } from "react-native";
import Constants from "expo-constants";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isExpoGo } from "./expo-go";
import { requireGoogleSignIn } from "./google-auth-module";
import type { GoogleSignInModule } from "./google-auth-types";
import { createIsolatedModule } from "./isolated-module";

/**
 * Native Google Sign-In → Supabase `signInWithIdToken`.
 *
 * Why native: the browser flow (`signInWithOAuth` + `openAuthSessionAsync`)
 * opens the Supabase authorize URL, so iOS asks `"Frapp" Wants to Use
 * "<project-ref>.supabase.co" to Sign In`, and Android shows that host in a
 * Custom Tab. Google's SDK opens Google's own pages instead: iOS asks for
 * "google.com", and Android shows Google's account sheet (#2126).
 *
 * The browser flow stays the fallback: on web, in Expo Go (which does not ship
 * this native module), in a binary built before the package landed, when a
 * client ID is missing, and when Google or Supabase refuses the configuration
 * (see `isConfigurationError` / `isProviderConfigRejection`). A member who
 * hits a misconfiguration still signs in; the warning is for us.
 */

const googleSignIn = createIsolatedModule<GoogleSignInModule>({
  packageName: "@react-native-google-signin/google-signin",
  whenUnavailable: "using browser Google sign-in.",
  load: requireGoogleSignIn,
  // Web has no native target, and Expo Go does not ship the module: its JS
  // reads the native constants at import, so requiring it there would throw.
  isUnavailable: () =>
    (Platform.OS !== "ios" && Platform.OS !== "android") || isExpoGo(),
});

export const setGoogleSignInLoaderForTests = googleSignIn.setLoaderForTests;

type GoogleClientIds = { webClientId: string; iosClientId?: string };

/**
 * The Google Cloud OAuth client IDs, from `app.json` → `extra.googleSignIn`.
 * Client IDs are not secrets. Returns `null` (browser flow) when this
 * platform's client is not recorded there:
 *
 * - iOS needs its own iOS client, and `app.config.js` registers that client's
 *   reversed ID as a URL scheme only when it is set.
 * - Android signs in against the Web client. The SDK never reads
 *   `androidClientId`; Google matches the app by package name and signing-key
 *   SHA-1 against an Android client in the same Cloud project. The field
 *   records that client exists, because without it every attempt ends in
 *   `DEVELOPER_ERROR` after the member has already picked an account.
 */
export function googleClientIds(): GoogleClientIds | null {
  const ids = (
    Constants.expoConfig?.extra as
      { googleSignIn?: Record<string, unknown> } | undefined
  )?.googleSignIn;
  const webClientId = asClientId(ids?.webClientId);
  if (!webClientId) return null;
  if (Platform.OS === "android") {
    return asClientId(ids?.androidClientId) ? { webClientId } : null;
  }
  const iosClientId = asClientId(ids?.iosClientId);
  return iosClientId ? { webClientId, iosClientId } : null;
}

function asClientId(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export type NativeGoogleResult = "completed" | "cancelled" | "unavailable";

export async function signInWithNativeGoogle(
  supabase: Pick<SupabaseClient, "auth">,
): Promise<NativeGoogleResult> {
  const clientIds = googleClientIds();
  if (!clientIds) return "unavailable";
  const google = googleSignIn.load();
  if (!google) return "unavailable";
  const { GoogleSignin, statusCodes } = google;

  let idToken: string | null;
  try {
    GoogleSignin.configure(clientIds);
    if (Platform.OS === "android") {
      await GoogleSignin.hasPlayServices({
        showPlayServicesUpdateDialog: true,
      });
    }
    const response = await GoogleSignin.signIn();
    if (response.type === "cancelled") return "cancelled";
    idToken = response.data.idToken;
  } catch (error) {
    const code = errorCode(error);
    // A second tap while the sheet is already up: the first attempt owns it.
    if (
      code === statusCodes.SIGN_IN_CANCELLED ||
      code === statusCodes.IN_PROGRESS
    ) {
      return "cancelled";
    }
    if (isConfigurationError(code, statusCodes)) {
      console.warn(
        "Native Google sign-in is not usable on this build; using browser Google sign-in.",
        error,
      );
      return "unavailable";
    }
    throw error;
  }

  // The SDK remembers the account it signed in. Forget it, so the next sign-in
  // (after a sign-out here) shows the account picker again, as the browser
  // flow's `prompt=select_account` did. The Supabase session is unaffected.
  GoogleSignin.signOut().catch(() => {});

  if (!idToken) return "unavailable";

  const { error } = await supabase.auth.signInWithIdToken({
    provider: "google",
    token: idToken,
  });
  if (error) {
    if (isProviderConfigRejection(error)) {
      console.warn(
        "Supabase refused the native Google ID token; using browser Google sign-in.",
        error,
      );
      return "unavailable";
    }
    throw error;
  }
  return "completed";
}

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error))
    return undefined;
  return typeof error.code === "string" ? error.code : String(error.code);
}

/**
 * Errors that mean this build or Google Cloud is not set up for native sign-in,
 * where the browser flow still works:
 *
 * - `"10"`: Android `DEVELOPER_ERROR`, no Android OAuth client in the Cloud
 *   project matches this package and signing-key SHA-1.
 * - `"configure"`: iOS found no client ID.
 * - `"SIGN_IN_ERROR"`: iOS raised an exception, which in practice is the
 *   missing reversed-client-ID URL scheme (a binary built without the iOS
 *   client ID, reached by an update that has one).
 * - `PLAY_SERVICES_NOT_AVAILABLE`: an Android device without Play services.
 */
function isConfigurationError(
  code: string | undefined,
  statusCodes: GoogleSignInModule["statusCodes"],
): boolean {
  return (
    code === "10" ||
    code === "configure" ||
    code === "SIGN_IN_ERROR" ||
    code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE
  );
}

/**
 * Supabase Auth refusing the token because its Google provider is not set up
 * for native clients: the iOS client ID missing from **Client IDs** ("Unacceptable
 * audience in id_token"), or **Skip nonce check** off while iOS's SDK puts its
 * own nonce in the token. Anything else (an expired token, a network failure)
 * is a real error for the sign-in screen.
 */
function isProviderConfigRejection(error: { message?: string }): boolean {
  return /audience|nonce/i.test(error.message ?? "");
}
