import { describe, expect, it } from "vitest";
import {
  AUTH_FAILURE_REPORT_INTERVAL_MS,
  EMAIL_SEND_CAPPED_CODE,
  buildAuthFailureReport,
  createAuthFailureReporter,
  type AuthFailureReport,
} from "./auth-failures";

/** An `AuthApiError` as supabase-js builds it, with the fields it carries. */
function authApiError(
  code: string,
  status: number,
  message = "refused",
): Error & { code: string; status: number } {
  return Object.assign(new Error(message), {
    name: "AuthApiError",
    code,
    status,
    __isAuthError: true,
  });
}

function collect() {
  const reports: AuthFailureReport[] = [];
  let at = 0;
  let online = true;
  const report = createAuthFailureReporter({
    capture: (r) => reports.push(r),
    now: () => at,
    isOnline: () => online,
  });
  return {
    report,
    reports,
    advance(ms: number) {
      at += ms;
    },
    setOnline(next: boolean) {
      online = next;
    },
  };
}

describe("buildAuthFailureReport", () => {
  it("reports a wrong password as a counted refusal at info", () => {
    const r = buildAuthFailureReport({
      flow: "password_sign_in",
      screen: "/sign-in",
      error: authApiError("invalid_credentials", 400),
    });
    expect(r).not.toBeNull();
    expect(r!.level).toBe("info");
    expect(r!.error.name).toBe("AuthRefusal");
    expect(r!.error.message).toBe("password_sign_in refused (invalid_credentials)");
    expect(r!.fingerprint).toEqual(["signed-out-auth", "password_sign_in", "invalid_credentials"]);
    expect(r!.tags).toEqual({
      auth_flow: "password_sign_in",
      auth_screen: "/sign-in",
      auth_failure_kind: "refusal",
      auth_expected: "true",
      auth_error_code: "invalid_credentials",
      "http.status_code": "400",
    });
  });

  it("reports launch day's two refusals at info", () => {
    for (const [code, status, message] of [
      ["email_not_confirmed", 400, "Email not confirmed"],
      ["over_email_send_rate_limit", 429, "you can only request this after 52 seconds."],
    ] as const) {
      const r = buildAuthFailureReport({
        flow: "password_sign_in",
        screen: "/sign-in",
        error: authApiError(code, status, message),
      });
      expect(r!.level).toBe("info");
      expect(r!.tags.auth_error_code).toBe(code);
    }
  });

  it("reports a 5xx as an error, even with an expected code", () => {
    const r = buildAuthFailureReport({
      flow: "magic_link_send",
      screen: "/sign-in",
      error: authApiError("over_email_send_rate_limit", 500, "after 3 seconds"),
    });
    expect(r!.level).toBe("error");
    expect(r!.error.name).toBe("AuthFailure");
    expect(r!.tags.auth_failure_kind).toBe("server");
    expect(r!.error.message).toBe("magic_link_send failed (over_email_send_rate_limit, 500)");
  });

  it("reports a code it does not know as an error, so a misconfigured provider surfaces", () => {
    const r = buildAuthFailureReport({
      flow: "auth_callback",
      screen: "/auth/callback",
      error: authApiError("provider_disabled", 400),
    });
    expect(r!.level).toBe("error");
    expect(r!.tags.auth_expected).toBe("false");
    expect(r!.fingerprint).toEqual(["signed-out-auth", "auth_callback", "provider_disabled"]);
  });

  it("reports a callback's own code without an error object", () => {
    const r = buildAuthFailureReport({
      flow: "auth_callback",
      screen: "/auth/callback",
      code: "otp_expired",
    });
    expect(r!.level).toBe("info");
    expect(r!.tags).toMatchObject({
      auth_error_code: "otp_expired",
      auth_failure_kind: "refusal",
    });
    expect(r!.tags["http.status_code"]).toBeUndefined();
  });

  it("reports a dead request while online as an error, and nothing while offline", () => {
    const dead = Object.assign(new Error("Failed to fetch"), {
      name: "AuthRetryableFetchError",
      status: 0,
    });
    const online = buildAuthFailureReport(
      { flow: "password_sign_in", screen: "/sign-in", error: dead },
      true,
    );
    expect(online!.level).toBe("error");
    expect(online!.tags.auth_failure_kind).toBe("network");
    expect(online!.fingerprint).toEqual(["signed-out-auth", "password_sign_in", "network"]);
    expect(
      buildAuthFailureReport({ flow: "password_sign_in", screen: "/sign-in", error: dead }, false),
    ).toBeNull();
  });

  it("splits the project's hourly email cap from the per-address cooldown", () => {
    const cooldown = buildAuthFailureReport({
      flow: "magic_link_send",
      screen: "/sign-in",
      error: authApiError(
        "over_email_send_rate_limit",
        429,
        "For security purposes, you can only request this after 44 seconds.",
      ),
    });
    expect(cooldown!.level).toBe("info");
    expect(cooldown!.tags.auth_error_code).toBe("over_email_send_rate_limit");

    const capped = buildAuthFailureReport({
      flow: "magic_link_send",
      screen: "/sign-in",
      error: authApiError("over_email_send_rate_limit", 429, "Email rate limit exceeded"),
    });
    expect(capped!.level).toBe("error");
    expect(capped!.tags.auth_error_code).toBe(EMAIL_SEND_CAPPED_CODE);
    expect(capped!.fingerprint).toEqual(["signed-out-auth", "magic_link_send", EMAIL_SEND_CAPPED_CODE]);
    // The sentence decided the split and is still never sent.
    expect(JSON.stringify(capped)).not.toContain("rate limit exceeded");
  });

  it("reads a bare TypeError as a bug, not a dead request", () => {
    const r = buildAuthFailureReport({
      flow: "oauth_start",
      screen: "/sign-in",
      error: new TypeError("Cannot read properties of undefined (reading 'signIn')"),
    });
    expect(r!.tags.auth_failure_kind).toBe("unknown");
    expect(r!.fingerprint).toEqual(["signed-out-auth", "oauth_start", "unknown"]);
  });

  it("reports nothing for a code-less failure while offline (a native SDK giving out)", () => {
    const nativeGaveOut = new Error("Unable to finish sign-in. Retry in a moment.");
    expect(
      buildAuthFailureReport({ flow: "oauth_start", screen: "/sign-in", error: nativeGaveOut }, false),
    ).toBeNull();
    expect(
      buildAuthFailureReport({ flow: "oauth_start", screen: "/sign-in", error: nativeGaveOut }, true)!.level,
    ).toBe("error");
    // A refusal with a code is still counted offline: Auth answered.
    expect(
      buildAuthFailureReport(
        { flow: "password_sign_in", screen: "/sign-in", error: authApiError("invalid_credentials", 400) },
        false,
      ),
    ).not.toBeNull();
  });

  it("names an unidentifiable failure unknown, at error", () => {
    const r = buildAuthFailureReport({
      flow: "sign_up",
      screen: "/sign-up",
      error: "boom",
    });
    expect(r!.level).toBe("error");
    expect(r!.tags.auth_failure_kind).toBe("unknown");
  });

  it("drops a screen that is not a template", () => {
    for (const screen of [
      "/join?token=abc123",
      "/members/3f2a9c1e-1111-4222-8333-944455556666",
      "https://app.frapp.live/sign-in",
      "/auth/callback#access_token=x",
      "sign-in",
    ]) {
      const r = buildAuthFailureReport({
        flow: "auth_callback",
        screen,
        code: "access_denied",
      });
      expect(r!.tags.auth_screen, screen).toBe("unknown");
    }
    expect(
      buildAuthFailureReport({ flow: "auth_callback", screen: "/(auth)/sign-in", code: "oauth_cancelled" })!
        .tags.auth_screen,
    ).toBe("/(auth)/sign-in");
  });

  it("drops a code that is not identifier-shaped", () => {
    const r = buildAuthFailureReport({
      flow: "auth_callback",
      screen: "/auth/callback",
      code: "Email link is invalid or has expired",
    });
    expect(r!.tags.auth_error_code).toBeUndefined();
    expect(r!.level).toBe("error");
  });
});

describe("what a report never carries", () => {
  const EMAIL = "member@school.edu";
  const PASSWORD = "hunter2-correct-horse";
  // Assembled at runtime so the secret scan doesn't read a JWT literal.
  const ACCESS_TOKEN = ["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiJ4In0", "c".repeat(43)].join(".");
  const REFRESH_TOKEN = "v1.refresh-abcdefghijklmnop";
  const OTP = "482913";
  const CALLBACK_URL = `https://app.frapp.live/auth/callback?code=${"c".repeat(36)}&token_hash=pkce_${OTP}`;
  const SECRETS = [EMAIL, PASSWORD, ACCESS_TOKEN, REFRESH_TOKEN, OTP, CALLBACK_URL, "code=", "token_hash", "@"];

  /** An error stuffed with everything a careless caller might hand over. */
  function loadedError(code: string, status: number) {
    return Object.assign(
      new Error(`Email address "${EMAIL}" is invalid; see ${CALLBACK_URL}`),
      {
        name: "AuthApiError",
        code,
        status,
        email: EMAIL,
        password: PASSWORD,
        access_token: ACCESS_TOKEN,
        refresh_token: REFRESH_TOKEN,
        token: OTP,
        url: CALLBACK_URL,
        stack: `AuthApiError: ${EMAIL}\n    at ${CALLBACK_URL}`,
      },
    );
  }

  function serialized(report: AuthFailureReport): string {
    return JSON.stringify({
      name: report.error.name,
      message: report.error.message,
      level: report.level,
      fingerprint: report.fingerprint,
      tags: report.tags,
    });
  }

  it.each([
    ["email_address_invalid", 400],
    ["invalid_credentials", 400],
    ["unexpected_failure", 500],
    ["otp_expired", 403],
  ])("carries no email, password, token, OTP or URL for %s", (code, status) => {
    const report = buildAuthFailureReport({
      flow: "password_sign_in",
      screen: CALLBACK_URL,
      error: loadedError(code, status),
    });
    expect(report).not.toBeNull();
    const payload = serialized(report!);
    for (const secret of SECRETS) {
      expect(payload, secret).not.toContain(secret);
    }
    // The error sent is built here, never the one handed in.
    expect(report!.error.stack ?? "").not.toContain(EMAIL);
    expect(Object.keys(report!.tags).sort()).toEqual(
      ["auth_error_code", "auth_expected", "auth_failure_kind", "auth_flow", "auth_screen", "http.status_code"].sort(),
    );
  });

  it("ignores a code argument that is itself a secret", () => {
    for (const code of [OTP, ACCESS_TOKEN, EMAIL, CALLBACK_URL]) {
      const report = buildAuthFailureReport({ flow: "auth_callback", screen: "/auth/callback", code });
      expect(serialized(report!)).not.toContain(code);
    }
  });
});

describe("createAuthFailureReporter", () => {
  it("reports one failure once per interval per fingerprint", () => {
    const c = collect();
    const input = {
      flow: "password_sign_in" as const,
      screen: "/sign-in",
      error: authApiError("invalid_credentials", 400),
    };
    c.report(input);
    c.report(input);
    expect(c.reports).toHaveLength(1);
    c.report({ ...input, error: authApiError("email_not_confirmed", 400) });
    expect(c.reports).toHaveLength(2);
    c.advance(AUTH_FAILURE_REPORT_INTERVAL_MS);
    c.report(input);
    expect(c.reports).toHaveLength(3);
  });

  it("reads the online state at report time", () => {
    const c = collect();
    c.setOnline(false);
    c.report({
      flow: "sign_up",
      screen: "/sign-up",
      error: Object.assign(new TypeError("Load failed"), { name: "AuthRetryableFetchError", status: 0 }),
    });
    expect(c.reports).toHaveLength(0);
  });

  it("never throws, even when capture does", () => {
    const report = createAuthFailureReporter({
      capture: () => {
        throw new Error("transport down");
      },
    });
    expect(() =>
      report({ flow: "auth_callback", screen: "/sign-in", code: "provider_disabled" }),
    ).not.toThrow();
  });
});
