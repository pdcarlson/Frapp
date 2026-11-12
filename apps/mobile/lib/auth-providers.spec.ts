import { describe, expect, it } from "vitest";
import { MemberFacingError } from "@repo/hooks/error-copy";
import {
  DEAD_LINK_COPY,
  describeAuthReturnError,
  describeOAuthKickoffError,
  FINISH_FAILED_COPY,
  IDENTITY_COLLISION_COPY,
  isApplePrivateRelayEmail,
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

describe("never the provider's or the OS's sentence (#3833)", () => {
  it("drops Apple's native sheet error for the start copy", () => {
    expect(
      describeOAuthKickoffError(
        new Error(
          "The operation couldn't be completed. (com.apple.AuthenticationServices.AuthorizationError error 1000.)",
        ),
      ),
    ).toBe("Unable to start sign-in. Retry in a moment.");
  });

  it("keeps the app's own member-facing sentence", () => {
    expect(
      describeOAuthKickoffError(new MemberFacingError(FINISH_FAILED_COPY)),
    ).toBe(FINISH_FAILED_COPY);
  });

  it("tells a dead email link by its code, not GoTrue's sentence", () => {
    expect(
      describeAuthReturnError({
        message: "Email link is invalid or has expired",
        code: "otp_expired",
      }),
    ).toBe(DEAD_LINK_COPY);
    expect(
      describeAuthReturnError({ message: "Email link is invalid or has expired" }),
    ).toBe(FINISH_FAILED_COPY);
  });
});
