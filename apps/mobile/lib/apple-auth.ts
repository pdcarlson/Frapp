import { Platform } from "react-native";
import * as Crypto from "expo-crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAppleAuth } from "./apple-auth-module";
import type { AppleAuthModule } from "./apple-auth-types";
import { createIsolatedModule } from "./isolated-module";

/**
 * Isolation module for `expo-apple-authentication`.
 *
 * Expo Go on iOS may ship the module (it is in SDK 57's bundled natives), but
 * an unguarded static import still kills `expo export --platform web` the
 * same way Stripe does. Native SIWA is reached only through this file.
 * Browser OAuth (`signInWithOAuth`) is the fallback on Android, web, and when
 * the module is missing.
 */

const appleAuth = createIsolatedModule<AppleAuthModule>({
  packageName: "expo-apple-authentication",
  whenUnavailable: "using browser Sign in with Apple.",
  load: requireAppleAuth,
  // Native SIWA is iOS-only; everywhere else the browser OAuth fallback is the
  // intended path, not a degradation.
  isUnavailable: () => Platform.OS !== "ios",
});

export const setAppleAuthLoaderForTests = appleAuth.setLoaderForTests;

const loadAppleAuth = appleAuth.load;

export async function isNativeAppleAuthAvailable(): Promise<boolean> {
  const apple = loadAppleAuth();
  if (!apple) return false;
  try {
    return await apple.isAvailableAsync();
  } catch {
    return false;
  }
}

export type NativeAppleResult = "completed" | "cancelled" | "unavailable";

/**
 * Native Sign in with Apple → Supabase `signInWithIdToken`.
 *
 * A missing identity token is treated as unavailable so the caller can fall
 * through to the browser OAuth session rather than stranding the member.
 */
export async function signInWithNativeApple(
  supabase: Pick<SupabaseClient, "auth">,
): Promise<NativeAppleResult> {
  const apple = loadAppleAuth();
  if (!apple) return "unavailable";

  let available = false;
  try {
    available = await apple.isAvailableAsync();
  } catch {
    return "unavailable";
  }
  if (!available) return "unavailable";

  const rawNonce = Crypto.randomUUID();
  const hashedNonce = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    rawNonce,
  );

  try {
    const credential = await apple.signInAsync({
      requestedScopes: [
        apple.AppleAuthenticationScope.FULL_NAME,
        apple.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashedNonce,
    });
    if (!credential.identityToken) return "unavailable";

    const { error } = await supabase.auth.signInWithIdToken({
      provider: "apple",
      token: credential.identityToken,
      nonce: rawNonce,
    });
    if (error) throw error;

    const fullName = formatAppleFullName(credential.fullName);
    if (fullName) {
      try {
        const { error: metaError } = await supabase.auth.updateUser({
          data: { full_name: fullName },
        });
        if (metaError) {
          console.warn(
            "Signed in with Apple but could not store the display name.",
            metaError,
          );
        }
      } catch (metaError) {
        // Session is already established; AuthSync will fall back to email.
        console.warn(
          "Signed in with Apple but could not store the display name.",
          metaError,
        );
      }
    }
    return "completed";
  } catch (error) {
    if (isAppleCancel(error)) return "cancelled";
    throw error;
  }
}

function isAppleCancel(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? error.code : undefined;
  return code === "ERR_REQUEST_CANCELED" || code === "ERR_CANCELED";
}

function formatAppleFullName(
  fullName:
    | {
        givenName: string | null;
        familyName: string | null;
      }
    | null
    | undefined,
): string | null {
  if (!fullName) return null;
  const combined = [fullName.givenName, fullName.familyName]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(" ")
    .trim();
  return combined.length > 0 ? combined : null;
}
