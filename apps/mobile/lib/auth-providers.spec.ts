import { describe, expect, it } from "vitest";
import {
  describeOAuthKickoffError,
  IDENTITY_COLLISION_COPY,
  isApplePrivateRelayEmail,
  isIdentityCollisionError,
  OAUTH_UNAVAILABLE_COPY,
} from "./auth-providers";

describe("isApplePrivateRelayEmail", () => {
  it("recognises Hide My Email and rejects chapter addresses", () => {
    expect(isApplePrivateRelayEmail("n@privaterelay.appleid.com")).toBe(true);
    expect(isApplePrivateRelayEmail("officer@university.edu")).toBe(false);
    expect(isApplePrivateRelayEmail(null)).toBe(false);
  });
});

describe("describeOAuthKickoffError", () => {
  it("maps a colliding identity back to password or magic link", () => {
    expect(isIdentityCollisionError({ code: "identity_already_exists" })).toBe(
      true,
    );
    expect(describeOAuthKickoffError({ code: "user_already_exists" })).toBe(
      IDENTITY_COLLISION_COPY,
    );
  });

  it("maps an unconfigured provider to the unavailable copy", () => {
    expect(
      describeOAuthKickoffError({
        message: "Unsupported provider: provider is not enabled",
      }),
    ).toBe(OAUTH_UNAVAILABLE_COPY);
  });
});
