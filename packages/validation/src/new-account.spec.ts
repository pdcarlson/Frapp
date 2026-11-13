import { describe, expect, it } from "vitest";
import {
  EMAIL_LINK_MAX_AGE_MS,
  FIRST_SIGN_IN_WINDOW_MS,
  isConfirmedByThisSignIn,
  isEmailOnlyAccount,
  isFirstOAuthSignIn,
  isNewEmailSignIn,
} from "./new-account";

const T0 = Date.parse("2026-11-13T10:00:00Z");
const at = (offsetMs: number) => new Date(T0 + offsetMs).toISOString();

describe("isFirstOAuthSignIn", () => {
  const oauthUser = (gapMs: number, provider: unknown = "google") => ({
    created_at: at(0),
    last_sign_in_at: at(gapMs),
    app_metadata: { provider },
  });

  it("flags a Google or Apple account whose first sign-in is this one", () => {
    expect(isFirstOAuthSignIn(oauthUser(2_000))).toBe(true);
    expect(isFirstOAuthSignIn(oauthUser(2_000, "apple"))).toBe(true);
    expect(isFirstOAuthSignIn(oauthUser(FIRST_SIGN_IN_WINDOW_MS - 1_000))).toBe(true);
  });

  it("leaves a returning account, an email account and missing data alone", () => {
    expect(isFirstOAuthSignIn(oauthUser(FIRST_SIGN_IN_WINDOW_MS + 1_000))).toBe(false);
    expect(isFirstOAuthSignIn(oauthUser(2_000, "email"))).toBe(false);
    expect(isFirstOAuthSignIn({ created_at: at(0), app_metadata: { provider: "google" } })).toBe(false);
    expect(isFirstOAuthSignIn(null)).toBe(false);
  });
});

describe("isNewEmailSignIn", () => {
  const emailUser = (overrides: Record<string, unknown> = {}) => ({
    identities: [{ provider: "email" }],
    // Asked for at T0, opened an hour later: that sign-in confirmed it.
    created_at: at(0),
    email_confirmed_at: at(60 * 60_000),
    last_sign_in_at: at(60 * 60_000 + 1_000),
    ...overrides,
  });

  it("flags an email-only account this sign-in confirmed", () => {
    expect(isNewEmailSignIn(emailUser())).toBe(true);
  });

  it("leaves a returning chapterless account alone (confirmed long ago)", () => {
    expect(
      isNewEmailSignIn(emailUser({ last_sign_in_at: at(30 * 24 * 60 * 60_000) })),
    ).toBe(false);
  });

  it("leaves an account confirmed more than an email link lives after creation alone", () => {
    const late = EMAIL_LINK_MAX_AGE_MS + 60_000;
    expect(
      isConfirmedByThisSignIn(
        emailUser({ email_confirmed_at: at(late), last_sign_in_at: at(late) }),
      ),
    ).toBe(false);
  });

  it("leaves an account with Google or Apple attached, or no identities, alone", () => {
    expect(
      isEmailOnlyAccount(emailUser({ identities: [{ provider: "email" }, { provider: "google" }] })),
    ).toBe(false);
    expect(isEmailOnlyAccount(emailUser({ identities: [] }))).toBe(false);
    expect(isNewEmailSignIn(emailUser({ identities: null }))).toBe(false);
  });

  it("reads missing or broken timestamps as not new", () => {
    expect(isNewEmailSignIn(emailUser({ email_confirmed_at: null }))).toBe(false);
    expect(isNewEmailSignIn(emailUser({ created_at: "not a date" }))).toBe(false);
    expect(isNewEmailSignIn(undefined)).toBe(false);
  });
});
