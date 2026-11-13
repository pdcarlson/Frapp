import { describe, expect, it, vi } from "vitest";
import {
  describeOAuthKickoffError,
  IDENTITY_COLLISION_COPY,
  isApplePrivateRelayEmail,
  isPlaceholderAuthEmail,
  OAUTH_UNAVAILABLE_COPY,
  startWebOAuth,
} from "./oauth";

describe("isApplePrivateRelayEmail", () => {
  it("recognises Hide My Email addresses and nothing else", () => {
    expect(isApplePrivateRelayEmail("abc@privaterelay.appleid.com")).toBe(true);
    expect(isApplePrivateRelayEmail("ABC@PrivateRelay.AppleId.COM")).toBe(true);
    expect(isApplePrivateRelayEmail("officer@university.edu")).toBe(false);
    expect(isApplePrivateRelayEmail("")).toBe(false);
    expect(isApplePrivateRelayEmail(null)).toBe(false);
  });
});

describe("isPlaceholderAuthEmail", () => {
  it("matches the AuthSync fallback host only", () => {
    expect(isPlaceholderAuthEmail("noreply+abc@users.invalid")).toBe(true);
    expect(isPlaceholderAuthEmail("a@example.com")).toBe(false);
  });
});

describe("describeOAuthKickoffError", () => {
  it("guides a colliding email back to password or magic link", () => {
    expect(
      describeOAuthKickoffError({ code: "identity_already_exists" }),
    ).toBe(IDENTITY_COLLISION_COPY);
  });

  it("does not pretend an unconfigured provider is the member's fault", () => {
    expect(
      describeOAuthKickoffError({
        message: "Unsupported provider: provider is not enabled",
      }),
    ).toBe(OAUTH_UNAVAILABLE_COPY);
  });

  it("never shows the provider's own sentence", () => {
    expect(describeOAuthKickoffError({ message: "Access denied" })).toBe(
      "Unable to start sign-in. Retry in a moment.",
    );
  });
});

describe("startWebOAuth", () => {
  it("starts PKCE OAuth toward /auth/callback with the guarded next path", async () => {
    const signInWithOAuth = vi.fn(async () => ({ error: null }));
    const supabase = { auth: { signInWithOAuth } };

    const result = await startWebOAuth(
      supabase,
      "google",
      "https://app.frapp.live",
      "/join?token=inv-1",
    );

    expect(result.error).toBeNull();
    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: {
        redirectTo:
          "https://app.frapp.live/auth/callback?next=%2Fjoin%3Ftoken%3Dinv-1",
        queryParams: { prompt: "select_account" },
      },
    });
  });

  it("does not send Google prompt params for Apple", async () => {
    const signInWithOAuth = vi.fn(async () => ({ error: null }));
    await startWebOAuth(
      { auth: { signInWithOAuth } },
      "apple",
      "https://app.staging.frapp.live",
      "/chat",
    );
    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: "apple",
      options: {
        redirectTo: "https://app.staging.frapp.live/auth/callback?next=%2Fchat",
        queryParams: undefined,
      },
    });
  });

  it("refuses an off-origin next the same way magic-link does", async () => {
    const signInWithOAuth = vi.fn(async () => ({ error: null }));
    await startWebOAuth(
      { auth: { signInWithOAuth } },
      "apple",
      "https://app.frapp.live",
      "https://evil.example/phish",
    );
    expect(signInWithOAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          redirectTo: "https://app.frapp.live/auth/callback?next=%2Fchat",
        }),
      }),
    );
  });

  it("returns the provider error so the screen can map collision copy", async () => {
    const signInWithOAuth = vi.fn(async () => ({
      error: { message: "already been registered", code: "identity_already_exists" },
    }));
    const result = await startWebOAuth(
      { auth: { signInWithOAuth } },
      "google",
      "https://app.frapp.live",
      "/chat",
    );
    expect(result.error).toEqual({
      message: "already been registered",
      code: "identity_already_exists",
    });
  });
});

describe("startWebOAuth from the sign-in screen", () => {
  it("tags the callback as a sign-in so a new account can be flagged", async () => {
    const signInWithOAuth = vi.fn(async () => ({ error: null }));
    await startWebOAuth(
      { auth: { signInWithOAuth } },
      "google",
      "https://app.frapp.live",
      "/chat",
      "sign-in",
    );
    expect(signInWithOAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          redirectTo:
            "https://app.frapp.live/auth/callback?next=%2Fchat&intent=sign-in",
        }),
      }),
    );
  });
});
