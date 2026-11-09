import { describe, expect, it } from "vitest";
import { AuthApiError, AuthWeakPasswordError } from "@supabase/supabase-js";
import { IDENTITY_COLLISION_COPY } from "./oauth";
import {
  EMAIL_SEND_CAPPED_COPY,
  EXISTING_ACCOUNT_COPY,
  UNCONFIRMED_EMAIL_COPY,
  WRONG_CREDENTIALS_COPY,
  cooldownCopy,
  describeEmailSendError,
  describePasswordSignInError,
  describeSignUpError,
  emailCooldownSeconds,
  isEmailNotConfirmed,
  isEmailSendCapped,
  isExistingAccountSignUp,
} from "./email-auth-errors";

/**
 * The refusals production's auth log recorded on 2026-11-09, as GoTrue sends
 * them. Each of them used to reach the member as "Something went wrong".
 */
const unconfirmed = () =>
  new AuthApiError("Email not confirmed", 400, "email_not_confirmed");
const wrongPassword = () =>
  new AuthApiError("Invalid login credentials", 400, "invalid_credentials");
const cooldown = (seconds: number) =>
  new AuthApiError(
    `For security purposes, you can only request this after ${seconds} seconds.`,
    429,
    "over_email_send_rate_limit",
  );

describe("password sign-in refusals", () => {
  it("names an unconfirmed address instead of 'Something went wrong'", () => {
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

describe("the project's hourly email cap", () => {
  // Same code as the per-address minute, no seconds: nothing went out.
  const capped = () =>
    new AuthApiError("Email rate limit exceeded", 429, "over_email_send_rate_limit");

  it("is not read as a cooldown", () => {
    expect(emailCooldownSeconds(capped())).toBeUndefined();
    expect(isEmailSendCapped(capped())).toBe(true);
    expect(isEmailSendCapped(cooldown(44))).toBe(false);
  });

  it("never says an email was just sent", () => {
    expect(describeEmailSendError(capped())).toBe(EMAIL_SEND_CAPPED_COPY);
    expect(describeEmailSendError(capped())).not.toMatch(/just sent/i);
    expect(describeSignUpError(capped())).toBe(EMAIL_SEND_CAPPED_COPY);
  });
});

describe("sign-up refusals", () => {
  it("asks for a different password when it appeared in a breach", () => {
    const error = new AuthWeakPasswordError("Password is known to be weak", 422, ["pwned"]);
    expect(describeSignUpError(error)).toMatch(/data breach/);
  });

  it("asks for a longer password when it is too short", () => {
    const error = new AuthWeakPasswordError("Password should be at least 6 characters.", 422, [
      "length",
    ]);
    expect(describeSignUpError(error)).toMatch(/at least 6 characters/);
  });

  it("sends an address that already has an account to sign-in, in the collision's words", () => {
    expect(EXISTING_ACCOUNT_COPY).toBe(IDENTITY_COLLISION_COPY);
    expect(
      describeSignUpError(new AuthApiError("User already registered", 422, "user_already_exists")),
    ).toBe(EXISTING_ACCOUNT_COPY);
    // GoTrue has sent this one without a code.
    expect(describeSignUpError(new Error("User already registered"))).toBe(EXISTING_ACCOUNT_COPY);
  });

  it("reads GoTrue's stand-in user for a taken address", () => {
    expect(isExistingAccountSignUp({ identities: [] })).toBe(true);
    expect(isExistingAccountSignUp({ identities: [{ id: "x" }] })).toBe(false);
    expect(isExistingAccountSignUp({})).toBe(false);
    expect(isExistingAccountSignUp(null)).toBe(false);
  });
});
