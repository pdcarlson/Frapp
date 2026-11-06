import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Platform } from "react-native";

const constantsState = vi.hoisted(() => ({
  executionEnvironment: "standalone",
  googleSignIn: {
    webClientId: "web-client.apps.googleusercontent.com",
    iosClientId: "ios-client.apps.googleusercontent.com",
    androidClientId: "android-client.apps.googleusercontent.com",
  } as Record<string, unknown> | undefined,
}));

vi.mock("expo-constants", () => ({
  default: {
    get executionEnvironment() {
      return constantsState.executionEnvironment;
    },
    get expoConfig() {
      return { extra: { googleSignIn: constantsState.googleSignIn } };
    },
  },
  ExecutionEnvironment: {
    Bare: "bare",
    Standalone: "standalone",
    StoreClient: "storeClient",
  },
}));

import {
  googleClientIds,
  setGoogleSignInLoaderForTests,
  signInWithNativeGoogle,
} from "./google-auth";
import type { GoogleSignInModule } from "./google-auth-types";

const statusCodes = {
  SIGN_IN_CANCELLED: "SIGN_IN_CANCELLED",
  IN_PROGRESS: "IN_PROGRESS",
  PLAY_SERVICES_NOT_AVAILABLE: "PLAY_SERVICES_NOT_AVAILABLE",
};

function fakeGoogle(signIn: GoogleSignInModule["GoogleSignin"]["signIn"]) {
  return {
    GoogleSignin: {
      configure: vi.fn(),
      hasPlayServices: vi.fn(async () => true),
      signIn: vi.fn(signIn),
      signOut: vi.fn(async () => null),
    },
    statusCodes,
  } satisfies GoogleSignInModule;
}

function fakeSupabase(error: { message: string } | null = null) {
  const signInWithIdToken = vi.fn(async () => ({ error }));
  return {
    client: { auth: { signInWithIdToken } } as never,
    signInWithIdToken,
  };
}

const success = async () =>
  ({ type: "success", data: { idToken: "google-id-token" } }) as const;

describe("native Google sign-in", () => {
  beforeEach(() => {
    constantsState.executionEnvironment = "standalone";
    constantsState.googleSignIn = {
      webClientId: "web-client.apps.googleusercontent.com",
      iosClientId: "ios-client.apps.googleusercontent.com",
      androidClientId: "android-client.apps.googleusercontent.com",
    };
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    setGoogleSignInLoaderForTests(null);
    vi.restoreAllMocks();
  });

  it("signs in on iOS with both client IDs and hands the ID token to Supabase", async () => {
    vi.spyOn(Platform, "OS", "get").mockReturnValue("ios");
    const google = fakeGoogle(success);
    setGoogleSignInLoaderForTests(() => google);
    const { client, signInWithIdToken } = fakeSupabase();

    await expect(signInWithNativeGoogle(client)).resolves.toBe("completed");
    expect(google.GoogleSignin.configure).toHaveBeenCalledWith({
      webClientId: "web-client.apps.googleusercontent.com",
      iosClientId: "ios-client.apps.googleusercontent.com",
    });
    expect(google.GoogleSignin.hasPlayServices).not.toHaveBeenCalled();
    expect(signInWithIdToken).toHaveBeenCalledWith({
      provider: "google",
      token: "google-id-token",
    });
    // Forgets the SDK's account so the next sign-in shows the picker.
    expect(google.GoogleSignin.signOut).toHaveBeenCalled();
  });

  it("signs in on Android with the Web client only, after checking Play services", async () => {
    vi.spyOn(Platform, "OS", "get").mockReturnValue("android");
    const google = fakeGoogle(success);
    setGoogleSignInLoaderForTests(() => google);
    const { client } = fakeSupabase();

    await expect(signInWithNativeGoogle(client)).resolves.toBe("completed");
    expect(google.GoogleSignin.configure).toHaveBeenCalledWith({
      webClientId: "web-client.apps.googleusercontent.com",
    });
    expect(google.GoogleSignin.hasPlayServices).toHaveBeenCalled();
  });

  it("is unavailable on iOS until the iOS client ID is set, without loading the package", async () => {
    vi.spyOn(Platform, "OS", "get").mockReturnValue("ios");
    constantsState.googleSignIn = { webClientId: "web", iosClientId: "" };
    const loader = vi.fn(() => fakeGoogle(success));
    setGoogleSignInLoaderForTests(loader);

    expect(googleClientIds()).toBeNull();
    await expect(signInWithNativeGoogle(fakeSupabase().client)).resolves.toBe(
      "unavailable",
    );
    expect(loader).not.toHaveBeenCalled();
  });

  it("is unavailable on Android until the Android client is recorded", async () => {
    vi.spyOn(Platform, "OS", "get").mockReturnValue("android");
    constantsState.googleSignIn = { webClientId: "web", iosClientId: "ios" };
    const loader = vi.fn(() => fakeGoogle(success));
    setGoogleSignInLoaderForTests(loader);

    await expect(signInWithNativeGoogle(fakeSupabase().client)).resolves.toBe(
      "unavailable",
    );
    expect(loader).not.toHaveBeenCalled();
  });

  it("is unavailable when no client IDs are configured", async () => {
    vi.spyOn(Platform, "OS", "get").mockReturnValue("android");
    constantsState.googleSignIn = undefined;
    await expect(signInWithNativeGoogle(fakeSupabase().client)).resolves.toBe(
      "unavailable",
    );
  });

  it("never loads the package in Expo Go or on web", async () => {
    const loader = vi.fn(() => fakeGoogle(success));

    vi.spyOn(Platform, "OS", "get").mockReturnValue("android");
    constantsState.executionEnvironment = "storeClient";
    setGoogleSignInLoaderForTests(loader);
    await expect(signInWithNativeGoogle(fakeSupabase().client)).resolves.toBe(
      "unavailable",
    );

    constantsState.executionEnvironment = "standalone";
    vi.spyOn(Platform, "OS", "get").mockReturnValue("web");
    setGoogleSignInLoaderForTests(loader);
    await expect(signInWithNativeGoogle(fakeSupabase().client)).resolves.toBe(
      "unavailable",
    );
    expect(loader).not.toHaveBeenCalled();
  });

  it("reports a dismissed sheet as cancelled, in either shape the SDK uses", async () => {
    vi.spyOn(Platform, "OS", "get").mockReturnValue("ios");
    setGoogleSignInLoaderForTests(() =>
      fakeGoogle(async () => ({ type: "cancelled", data: null })),
    );
    await expect(signInWithNativeGoogle(fakeSupabase().client)).resolves.toBe(
      "cancelled",
    );

    setGoogleSignInLoaderForTests(() =>
      fakeGoogle(async () => {
        throw Object.assign(new Error("in progress"), { code: "IN_PROGRESS" });
      }),
    );
    await expect(signInWithNativeGoogle(fakeSupabase().client)).resolves.toBe(
      "cancelled",
    );
  });

  it.each([
    ["Android DEVELOPER_ERROR", "10"],
    ["iOS missing URL scheme", "SIGN_IN_ERROR"],
    ["no Play services", "PLAY_SERVICES_NOT_AVAILABLE"],
  ])("falls back to the browser on %s", async (_label, code) => {
    vi.spyOn(Platform, "OS", "get").mockReturnValue("android");
    setGoogleSignInLoaderForTests(() =>
      fakeGoogle(async () => {
        throw Object.assign(new Error("config"), { code });
      }),
    );
    await expect(signInWithNativeGoogle(fakeSupabase().client)).resolves.toBe(
      "unavailable",
    );
  });

  it("rethrows other SDK errors", async () => {
    vi.spyOn(Platform, "OS", "get").mockReturnValue("android");
    const boom = Object.assign(new Error("network"), { code: "7" });
    setGoogleSignInLoaderForTests(() =>
      fakeGoogle(async () => {
        throw boom;
      }),
    );
    await expect(signInWithNativeGoogle(fakeSupabase().client)).rejects.toBe(
      boom,
    );
  });

  it("falls back when Supabase's Google provider is not set up for native tokens", async () => {
    vi.spyOn(Platform, "OS", "get").mockReturnValue("ios");
    setGoogleSignInLoaderForTests(() => fakeGoogle(success));

    for (const message of [
      "Unacceptable audience in id_token: [ios-client.apps.googleusercontent.com]",
      "Passed nonce and nonce in id_token should either both exist or not.",
    ]) {
      await expect(
        signInWithNativeGoogle(fakeSupabase({ message }).client),
      ).resolves.toBe("unavailable");
    }
  });

  it("rethrows any other Supabase refusal", async () => {
    vi.spyOn(Platform, "OS", "get").mockReturnValue("ios");
    setGoogleSignInLoaderForTests(() => fakeGoogle(success));
    await expect(
      signInWithNativeGoogle(
        fakeSupabase({ message: "Database error" }).client,
      ),
    ).rejects.toEqual({ message: "Database error" });
  });
});
