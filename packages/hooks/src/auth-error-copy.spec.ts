import { describe, expect, it } from "vitest";
import { OFFLINE_COPY, STATUS_ERROR_COPY } from "@repo/validation";
import {
  AUTH_FALLBACK_COPY,
  EMAIL_LINKS_OFF_COPY,
  EMAIL_SEND_CAPPED_COPY,
  UNCONFIRMED_EMAIL_COPY,
  WRONG_CREDENTIALS_COPY,
  authFallbackCopy,
  cooldownCopy,
  describeEmailSendError,
  describeOAuthError,
  describePasswordSignInError,
  describeSignUpError,
  emailCooldownSeconds,
  isEmailNotConfirmed,
  isEmailSendCapped,
  isExistingAccountSignUp,
  isIdentityCollisionError,
} from "./auth-error-copy";
import { MemberFacingError } from "./error-copy";

/**
 * auth-js's error shapes, built by hand so this package needn't depend on
 * `@supabase/supabase-js`: `AuthApiError` carries GoTrue's `status` and
 * `error_code`, `AuthWeakPasswordError` adds `reasons`, and a request that
 * never reached GoTrue is an `AuthRetryableFetchError` with status 0.
 */
function authApiError(message: string, status: number, code?: string) {
  return Object.assign(new Error(message), { name: "AuthApiError", status, code });
}

/**
 * The refusals production's auth log recorded on 2026-11-09, as GoTrue sends
 * them. Web read each as "Something went wrong"; mobile read the sentence.
 */
const unconfirmed = () => authApiError("Email not confirmed", 400, "email_not_confirmed");
const wrongPassword = () =>
  authApiError("Invalid login credentials", 400, "invalid_credentials");
const cooldown = (seconds: number) =>
  authApiError(
    `For security purposes, you can only request this after ${seconds} seconds.`,
    429,
    "over_email_send_rate_limit",
  );
const COLLISION = "An account with this email already exists.";

describe("password sign-in refusals", () => {
  it("names an unconfirmed address", () => {
    expect(isEmailNotConfirmed(unconfirmed())).toBe(true);
    expect(describePasswordSignInError(unconfirmed())).toBe(UNCONFIRMED_EMAIL_COPY);
  });

  it("recognises an unconfirmed address by message when the code is missing", () => {
    expect(isEmailNotConfirmed(new Error("Email not confirmed"))).toBe(true);
  });

  it("says a wrong password doesn't match, without saying which half", () => {
    expect(describePasswordSignInError(wrongPassword())).toBe(WRONG_CREDENTIALS_COPY);
    expect(isEmailNotConfirmed(wrongPassword())).toBe(false);
  });

  it("never shows GoTrue's own sentence", () => {
    for (const error of [unconfirmed(), wrongPassword(), cooldown(44)]) {
      expect(describePasswordSignInError(error)).not.toContain(error.message);
    }
  });

  it("drops an unknown GoTrue sentence for the fallback", () => {
    const banned = authApiError("User is banned", 400, "user_banned");
    expect(describePasswordSignInError(banned)).toBe(AUTH_FALLBACK_COPY);
  });
});

describe("the one-email-a-minute limit", () => {
  it("reads the seconds GoTrue names", () => {
    expect(emailCooldownSeconds(cooldown(44))).toBe(44);
    expect(emailCooldownSeconds(cooldown(1))).toBe(1);
  });

  it("is undefined for anything else", () => {
    expect(emailCooldownSeconds(unconfirmed())).toBeUndefined();
    expect(emailCooldownSeconds(new Error("x"))).toBeUndefined();
  });

  it("tells the member an email already went out, and when to ask again", () => {
    expect(describeEmailSendError(cooldown(44))).toBe(cooldownCopy(44));
    expect(cooldownCopy(44)).toContain("in 44 seconds");
    expect(cooldownCopy(1)).toContain("in 1 second.");
    expect(cooldownCopy(0)).toContain("in a moment");
  });
});

describe("email links switched off", () => {
  it("says so instead of asking to retry", () => {
    expect(
      describeEmailSendError(authApiError("Signups not allowed for otp", 422, "otp_disabled")),
    ).toBe(EMAIL_LINKS_OFF_COPY);
  });
});

describe("the project's hourly email cap", () => {
  // Same code as the per-address minute, no seconds: nothing went out.
  const capped = () =>
    authApiError("Email rate limit exceeded", 429, "over_email_send_rate_limit");

  it("is not read as a cooldown", () => {
    expect(emailCooldownSeconds(capped())).toBeUndefined();
    expect(isEmailSendCapped(capped())).toBe(true);
    expect(isEmailSendCapped(cooldown(44))).toBe(false);
  });

  it("never says an email was just sent", () => {
    expect(describeEmailSendError(capped())).toBe(EMAIL_SEND_CAPPED_COPY);
    expect(describeEmailSendError(capped())).not.toMatch(/just sent/i);
    expect(describeSignUpError(capped(), COLLISION)).toBe(EMAIL_SEND_CAPPED_COPY);
  });
});

describe("sign-up refusals", () => {
  const weak = (reasons: string[]) =>
    Object.assign(authApiError("Password is known to be weak", 422, "weak_password"), {
      reasons,
    });

  it("asks for a different password when it appeared in a breach", () => {
    expect(describeSignUpError(weak(["pwned"]), COLLISION)).toMatch(/data breach/);
  });

  it("asks for a longer password when it is too short", () => {
    expect(describeSignUpError(weak(["length"]), COLLISION)).toMatch(/at least 6 characters/);
  });

  it("sends an address that already has an account to sign-in, in the surface's words", () => {
    expect(
      describeSignUpError(authApiError("User already registered", 422, "user_already_exists"), COLLISION),
    ).toBe(COLLISION);
    // GoTrue has sent this one without a code.
    expect(describeSignUpError(new Error("User already registered"), COLLISION)).toBe(COLLISION);
  });

  it("reads GoTrue's stand-in user for a taken address", () => {
    expect(isExistingAccountSignUp({ identities: [] })).toBe(true);
    expect(isExistingAccountSignUp({ identities: [{ id: "x" }] })).toBe(false);
    expect(isExistingAccountSignUp({})).toBe(false);
    expect(isExistingAccountSignUp(null)).toBe(false);
  });
});

describe("isIdentityCollisionError", () => {
  it("matches GoTrue codes and the registered-email message", () => {
    expect(isIdentityCollisionError({ code: "identity_already_exists" })).toBe(true);
    expect(isIdentityCollisionError({ code: "user_already_exists" })).toBe(true);
    expect(isIdentityCollisionError({ code: "email_exists" })).toBe(true);
    expect(
      isIdentityCollisionError({
        message: "A user with this email address has already been registered",
      }),
    ).toBe(true);
    expect(isIdentityCollisionError({ message: "Invalid login credentials" })).toBe(false);
    expect(isIdentityCollisionError(null)).toBe(false);
  });
});

describe("describeOAuthError", () => {
  const copy = {
    identityCollision: COLLISION,
    providerUnavailable: "Unavailable.",
    deadLink: "Dead link.",
    fallback: "Couldn't start.",
  };

  it("maps each known refusal to the surface's sentence", () => {
    expect(describeOAuthError({ code: "email_exists" }, copy)).toBe(COLLISION);
    expect(
      describeOAuthError({ message: "Unsupported provider: provider is not enabled" }, copy),
    ).toBe("Unavailable.");
    expect(describeOAuthError(authApiError("x", 400, "provider_disabled"), copy)).toBe(
      "Unavailable.",
    );
    expect(
      describeOAuthError(
        authApiError("Email link is invalid or has expired", 403, "otp_expired"),
        copy,
      ),
    ).toBe("Dead link.");
  });

  it("shows the client's own member-facing sentence", () => {
    expect(describeOAuthError(new MemberFacingError("Unable to finish sign-in."), copy)).toBe(
      "Unable to finish sign-in.",
    );
  });

  it("never shows a provider's or the OS's sentence", () => {
    const apple = new Error(
      "The operation couldn't be completed. (com.apple.AuthenticationServices.AuthorizationError error 1000.)",
    );
    expect(describeOAuthError(apple, copy)).toBe("Couldn't start.");
    expect(describeOAuthError({ message: "Access denied" }, copy)).toBe("Couldn't start.");
  });
});

describe("authFallbackCopy", () => {
  it("reads no answer from GoTrue as a dropped connection", () => {
    const unreachable = Object.assign(new Error("Failed to fetch"), {
      name: "AuthRetryableFetchError",
      status: 0,
    });
    expect(authFallbackCopy(unreachable)).toBe(OFFLINE_COPY);
    expect(authFallbackCopy(new TypeError("Network request failed"))).toBe(OFFLINE_COPY);
  });

  it("doesn't blame the member's connection for a GoTrue outage", () => {
    const outage = Object.assign(new Error("Service unavailable"), {
      name: "AuthRetryableFetchError",
      status: 503,
    });
    expect(authFallbackCopy(outage)).toBe(AUTH_FALLBACK_COPY);
  });

  it("says too many tries for any 429", () => {
    expect(authFallbackCopy(authApiError("Request rate limit reached", 429, "over_request_rate_limit"))).toBe(
      STATUS_ERROR_COPY[429],
    );
  });

  it("never borrows the API's 401 or 403 lines before sign-in", () => {
    expect(authFallbackCopy(authApiError("x", 403, "unexpected_failure"))).toBe(AUTH_FALLBACK_COPY);
    expect(authFallbackCopy(authApiError("x", 401))).toBe(AUTH_FALLBACK_COPY);
  });
});
