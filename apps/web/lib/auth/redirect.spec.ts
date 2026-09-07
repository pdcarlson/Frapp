import { describe, expect, it } from "vitest";
import {
  AUTH_CALLBACK_PATH,
  buildAuthCallbackUrl,
  describeAuthError,
  resolveRedirectPath,
} from "./redirect";

describe("resolveRedirectPath", () => {
  it("keeps a same-origin path, query included", () => {
    expect(resolveRedirectPath("/join?token=abc")).toBe("/join?token=abc");
  });

  it("falls back to the dashboard for nothing, a bare word, or an absolute URL", () => {
    expect(resolveRedirectPath(null)).toBe("/chat");
    expect(resolveRedirectPath("")).toBe("/chat");
    expect(resolveRedirectPath("chat")).toBe("/chat");
    expect(resolveRedirectPath("https://evil.example/x")).toBe("/chat");
  });

  it("refuses a protocol-relative URL — `new URL('//evil.example', origin)` would leave the origin", () => {
    expect(resolveRedirectPath("//evil.example/x")).toBe("/chat");
  });

  it("refuses every shape the WHATWG parser would resolve off-origin, not just `//`", () => {
    // `\` is `/` to the parser in an https URL: `/\evil.example/x` → https://evil.example/x
    expect(resolveRedirectPath("/\\evil.example/x")).toBe("/chat");
    expect(resolveRedirectPath("/\\/evil.example")).toBe("/chat");
    // What the parser would actually produce for each, as the proof the guard keys on it.
    for (const bad of ["/\\evil.example/x", "//evil.example/x", "/\\/evil.example"]) {
      expect(new URL(bad, "https://app.frapp.live").origin).not.toBe("https://app.frapp.live");
    }
  });

  it("hands back the parser's normalised path, query and fragment", () => {
    expect(resolveRedirectPath("/join?token=abc#x")).toBe("/join?token=abc#x");
    // Percent-encoded slashes stay in the path — they never become an authority.
    expect(resolveRedirectPath("/%2F%2Fevil.example")).toBe("/%2F%2Fevil.example");
    expect(new URL("/%2F%2Fevil.example", "https://app.frapp.live").origin).toBe("https://app.frapp.live");
  });
});

describe("buildAuthCallbackUrl", () => {
  it("lands on /auth/callback with the destination carried as `next`", () => {
    const url = new URL(buildAuthCallbackUrl("https://app.frapp.live", "/join?token=abc"));
    expect(url.origin).toBe("https://app.frapp.live");
    expect(url.pathname).toBe(AUTH_CALLBACK_PATH);
    expect(url.searchParams.get("next")).toBe("/join?token=abc");
  });

  it("applies the open-redirect guard to `next` before it ever reaches the email", () => {
    const url = new URL(buildAuthCallbackUrl("https://app.frapp.live", "https://evil.example/x"));
    expect(url.searchParams.get("next")).toBe("/chat");
  });
});

describe("describeAuthError", () => {
  it("has member-facing wording for every code the callback emits", () => {
    for (const code of ["otp_expired", "access_denied", "otp_disabled", "exchange_failed", "missing_code"]) {
      expect(describeAuthError(code)).not.toMatch(/^Request a new link below, or sign in/);
    }
    expect(describeAuthError("something_else")).toMatch(/Request a new link/);
  });
});
