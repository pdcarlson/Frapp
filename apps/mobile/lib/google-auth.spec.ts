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

// Whether the running binary registers the iOS client's URL scheme.
const canOpenURL = vi.hoisted(() =>
  vi.fn<(url: string) => Promise<boolean>>(async () => true),
);

vi.mock("react-native", async () => {
  const { reactNativeStub } = await import("../test/react-native-stub");
  return { ...reactNativeStub, Linking: { canOpenURL } };
});

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
  googleIosUrlScheme,
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

const rejectWith =
  (code: string, message = "native") =>
  async () => {
    throw Object.assign(new Error(message), { code });
  };

describe("native Google sign-in", () => {
  beforeEach(() => {
    constantsState.executionEnvironment = "standalone";
    constantsState.googleSignIn = {
      webClientId: "web-client.apps.googleusercontent.com",
      iosClientId: "ios-client.apps.googleusercontent.com",
      androidClientId: "android-client.apps.googleusercontent.com",
    };
    canOpenURL.mockReset();
    canOpenURL.mockResolvedValue(true);
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
    expect(canOpenURL).toHaveBeenCalledWith(
      "com.googleusercontent.apps.ios-client://",
    );
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

  it("keeps iOS on the browser when the binary lacks the URL scheme, without touching the SDK", async () => {
    // An update set the iOS client ID on a binary built without it. A release
    // build would crash inside Google's SDK, so the SDK must never be reached.
    vi.spyOn(Platform, "OS", "get").mockReturnValue("ios");
    const loader = vi.fn(() => fakeGoogle(success));
    setGoogleSignInLoaderForTests(loader);

    canOpenURL.mockResolvedValue(false);
    await expect(signInWithNativeGoogle(fakeSupabase().client)).resolves.toBe(
      "unavailable",
    );
    canOpenURL.mockRejectedValue(new Error("not allowed"));
    await expect(signInWithNativeGoogle(fakeSupabase().client)).resolves.toBe(
      "unavailable",
    );
    expect(loader).not.toHaveBeenCalled();
  });

  it("keeps iOS on the browser when the iOS client ID is not a Google client ID", async () => {
    vi.spyOn(Platform, "OS", "get").mockReturnValue("ios");
    constantsState.googleSignIn = { webClientId: "web", iosClientId: "oops" };
    const loader = vi.fn(() => fakeGoogle(success));
    setGoogleSignInLoaderForTests(loader);

    expect(googleIosUrlScheme("oops")).toBeNull();
    await expect(signInWithNativeGoogle(fakeSupabase().client)).resolves.toBe(
      "unavailable",
    );
    expect(canOpenURL).not.toHaveBeenCalled();
    expect(loader).not.toHaveBeenCalled();
  });

  it("signs in on Android with the Web client only, checking Play services without a dialog", async () => {
    vi.spyOn(Platform, "OS", "get").mockReturnValue("android");
    const google = fakeGoogle(success);
    setGoogleSignInLoaderForTests(() => google);
    const { client } = fakeSupabase();

    await expect(signInWithNativeGoogle(client)).resolves.toBe("completed");
    expect(google.GoogleSignin.configure).toHaveBeenCalledWith({
      webClientId: "web-client.apps.googleusercontent.com",
    });
    // A dialog would sit under the browser fallback (the SDK rejects at once).
    expect(google.GoogleSignin.hasPlayServices).toHaveBeenCalledWith({
      showPlayServicesUpdateDialog: false,
    });
    expect(canOpenURL).not.toHaveBeenCalled();
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

  it("reports a dismissed sheet, or a second tap while it is open, as cancelled", async () => {
    vi.spyOn(Platform, "OS", "get").mockReturnValue("ios");
    setGoogleSignInLoaderForTests(() =>
      fakeGoogle(async () => ({ type: "cancelled", data: null })),
    );
    await expect(signInWithNativeGoogle(fakeSupabase().client)).resolves.toBe(
      "cancelled",
    );

    setGoogleSignInLoaderForTests(() => fakeGoogle(rejectWith("IN_PROGRESS")));
    await expect(signInWithNativeGoogle(fakeSupabase().client)).resolves.toBe(
      "cancelled",
    );
  });

  it.each([
    ["android", "Android DEVELOPER_ERROR", "10"],
    ["android", "Android SIGN_IN_FAILED", "12500"],
    ["android", "no current Play services", "PLAY_SERVICES_NOT_AVAILABLE"],
    ["ios", "iOS with no client ID", "configure"],
    ["ios", "an iOS exception in a Debug build", "SIGN_IN_ERROR"],
  ] as const)(
    "falls back to the browser on %s: %s",
    async (os, _label, code) => {
      vi.spyOn(Platform, "OS", "get").mockReturnValue(os);
      setGoogleSignInLoaderForTests(() => fakeGoogle(rejectWith(code)));
      await expect(signInWithNativeGoogle(fakeSupabase().client)).resolves.toBe(
        "unavailable",
      );
    },
  );

  it("falls back when Google returns no ID token", async () => {
    vi.spyOn(Platform, "OS", "get").mockReturnValue("android");
    setGoogleSignInLoaderForTests(() =>
      fakeGoogle(async () => ({ type: "success", data: { idToken: null } })),
    );
    const { client, signInWithIdToken } = fakeSupabase();
    await expect(signInWithNativeGoogle(client)).resolves.toBe("unavailable");
    expect(signInWithIdToken).not.toHaveBeenCalled();
  });

  it("turns any other SDK error into member copy, keeping the cause", async () => {
    vi.spyOn(Platform, "OS", "get").mockReturnValue("android");
    setGoogleSignInLoaderForTests(() =>
      fakeGoogle(rejectWith("7", "com.google.android.gms ApiException: 7")),
    );
    const failure = signInWithNativeGoogle(fakeSupabase().client);
    await expect(failure).rejects.toThrow(
      "Unable to finish sign-in. Retry in a moment.",
    );
    await expect(failure).rejects.toMatchObject({
      cause: { code: "7" },
    });
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
