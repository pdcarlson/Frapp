import { afterEach, describe, expect, it, vi } from "vitest";
import { Platform } from "react-native";

const digestStringAsync = vi.hoisted(() =>
  vi.fn(async (_alg: string, value: string) => `hashed:${value}`),
);
const randomUUID = vi.hoisted(() => vi.fn(() => "raw-nonce"));

vi.mock("expo-crypto", () => ({
  randomUUID,
  digestStringAsync,
  CryptoDigestAlgorithm: { SHA256: "SHA256" },
}));

import {
  isNativeAppleAuthAvailable,
  setAppleAuthLoaderForTests,
  signInWithNativeApple,
} from "./apple-auth";

describe("native Apple auth", () => {
  afterEach(() => {
    setAppleAuthLoaderForTests(null);
    vi.unstubAllGlobals();
  });

  it("is unavailable off iOS without loading the package", async () => {
    vi.spyOn(Platform, "OS", "get").mockReturnValue("android");
    const loader = vi.fn(() => {
      throw new Error("should not load");
    });
    setAppleAuthLoaderForTests(loader);
    expect(await isNativeAppleAuthAvailable()).toBe(false);
    expect(loader).not.toHaveBeenCalled();
  });

  it("signs in with the identity token and raw nonce", async () => {
    vi.spyOn(Platform, "OS", "get").mockReturnValue("ios");
    const signInAsync = vi.fn(async () => ({
      identityToken: "jwt-token",
      email: "n@privaterelay.appleid.com",
      fullName: { givenName: "Ada", familyName: "Lovelace" },
    }));
    setAppleAuthLoaderForTests(() => ({
      isAvailableAsync: async () => true,
      signInAsync,
      AppleAuthenticationScope: { FULL_NAME: "FULL_NAME", EMAIL: "EMAIL" },
    }));
    const signInWithIdToken = vi.fn(async () => ({ error: null }));
    const updateUser = vi.fn(async () => ({ error: null }));

    await expect(
      signInWithNativeApple({
        auth: { signInWithIdToken, updateUser },
      } as never),
    ).resolves.toBe("completed");
    expect(signInAsync).toHaveBeenCalledWith({
      requestedScopes: ["FULL_NAME", "EMAIL"],
      nonce: "hashed:raw-nonce",
    });
    expect(signInWithIdToken).toHaveBeenCalledWith({
      provider: "apple",
      token: "jwt-token",
      nonce: "raw-nonce",
    });
    expect(updateUser).toHaveBeenCalledWith({
      data: { full_name: "Ada Lovelace" },
    });
  });

  it("treats an Apple cancel as cancelled, not a failure", async () => {
    vi.spyOn(Platform, "OS", "get").mockReturnValue("ios");
    setAppleAuthLoaderForTests(() => ({
      isAvailableAsync: async () => true,
      signInAsync: async () => {
        const error = Object.assign(new Error("canceled"), {
          code: "ERR_REQUEST_CANCELED",
        });
        throw error;
      },
      AppleAuthenticationScope: { FULL_NAME: "FULL_NAME", EMAIL: "EMAIL" },
    }));

    await expect(
      signInWithNativeApple({
        auth: { signInWithIdToken: vi.fn() },
      } as never),
    ).resolves.toBe("cancelled");
  });

  it("falls through when Apple returns no identity token", async () => {
    vi.spyOn(Platform, "OS", "get").mockReturnValue("ios");
    const signInWithIdToken = vi.fn();
    setAppleAuthLoaderForTests(() => ({
      isAvailableAsync: async () => true,
      signInAsync: async () => ({
        identityToken: null,
        email: null,
        fullName: null,
      }),
      AppleAuthenticationScope: { FULL_NAME: "FULL_NAME", EMAIL: "EMAIL" },
    }));

    await expect(
      signInWithNativeApple({ auth: { signInWithIdToken } } as never),
    ).resolves.toBe("unavailable");
    expect(signInWithIdToken).not.toHaveBeenCalled();
  });

  it("still completes if storing the Apple display name fails", async () => {
    vi.spyOn(Platform, "OS", "get").mockReturnValue("ios");
    setAppleAuthLoaderForTests(() => ({
      isAvailableAsync: async () => true,
      signInAsync: async () => ({
        identityToken: "jwt-token",
        email: null,
        fullName: { givenName: "Ada", familyName: "Lovelace" },
      }),
      AppleAuthenticationScope: { FULL_NAME: "FULL_NAME", EMAIL: "EMAIL" },
    }));
    const signInWithIdToken = vi.fn(async () => ({ error: null }));
    const updateUser = vi.fn(async () => {
      throw new Error("network down");
    });

    await expect(
      signInWithNativeApple({
        auth: { signInWithIdToken, updateUser },
      } as never),
    ).resolves.toBe("completed");
    expect(signInWithIdToken).toHaveBeenCalled();
  });
});
