import { describe, expect, it } from "vitest";
import { IDENTITY_COLLISION_COPY } from "./oauth";
import {
  AUTH_CALLBACK_PATH,
  assignResolvedRedirect,
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
    for (const bad of [
      "/\\evil.example/x",
      "//evil.example/x",
      "/\\/evil.example",
    ]) {
      expect(new URL(bad, "https://app.frapp.live").origin).not.toBe(
        "https://app.frapp.live",
      );
    }
  });

  it("refuses `/.//host` — first parse stays on-origin, second parse is protocol-relative", () => {
    expect(resolveRedirectPath("/.//evil.example")).toBe("/chat");
    expect(resolveRedirectPath("/.//evil.example/phish")).toBe("/chat");
    expect(resolveRedirectPath("/..//evil.example")).toBe("/chat");
    const poisoned = resolveRedirectPath("/.//evil.example/phish");
    expect(new URL(poisoned, "https://app.frapp.live").origin).toBe(
      "https://app.frapp.live",
    );
  });

  it("hands back the parser's normalised path, query and fragment", () => {
    expect(resolveRedirectPath("/join?token=abc#x")).toBe("/join?token=abc#x");
    // Percent-encoded slashes stay in the path — they never become an authority.
    expect(resolveRedirectPath("/%2F%2Fevil.example")).toBe(
      "/%2F%2Fevil.example",
    );
    expect(
      new URL("/%2F%2Fevil.example", "https://app.frapp.live").origin,
    ).toBe("https://app.frapp.live");
  });
});

describe("assignResolvedRedirect", () => {
  it("puts the invite query on search, not encoded into pathname", () => {
    const url = new URL(
      "https://app.frapp.live/sign-in?token=leftover&redirectTo=%2Fjoin%3Ftoken%3Dabc",
    );
    assignResolvedRedirect(url, url.searchParams.get("redirectTo"));
    expect(url.pathname).toBe("/join");
    expect(url.searchParams.get("token")).toBe("abc");
    expect(url.toString()).toBe("https://app.frapp.live/join?token=abc");
  });

  it("is the opposite of stuffing `/join?token=` into pathname", () => {
    const buggy = new URL("https://app.frapp.live/sign-in");
    buggy.pathname = "/join?token=abc";
    buggy.search = "";
    // Node encodes the `?` into the path, so the request never hits `/join`.
    expect(buggy.pathname).not.toBe("/join");
    expect(buggy.pathname).toContain("%3F");
    expect(buggy.search).toBe("");

    const fixed = new URL("https://app.frapp.live/sign-in");
    assignResolvedRedirect(fixed, "/join?token=abc");
    expect(fixed.pathname).toBe("/join");
    expect(fixed.search).toBe("?token=abc");
  });

  it("falls back to /chat and refuses protocol-relative destinations", () => {
    const missing = new URL("https://app.frapp.live/sign-in");
    assignResolvedRedirect(missing, null);
    expect(missing.pathname).toBe("/chat");
    expect(missing.search).toBe("");

    const evil = new URL("https://app.frapp.live/sign-in");
    assignResolvedRedirect(evil, "//evil.example/x");
    expect(evil.origin).toBe("https://app.frapp.live");
    expect(evil.pathname).toBe("/chat");
  });

  it("does not bounce a signed-in member back onto /sign-in or /sign-up", () => {
    const loop = new URL(
      "https://app.frapp.live/sign-in?redirectTo=%2Fsign-in%3Ffoo%3D1",
    );
    assignResolvedRedirect(loop, loop.searchParams.get("redirectTo"));
    expect(loop.pathname).toBe("/chat");
    expect(loop.search).toBe("");

    const signUp = new URL("https://app.frapp.live/sign-up");
    assignResolvedRedirect(signUp, "/sign-up");
    expect(signUp.pathname).toBe("/chat");
  });
});

describe("buildAuthCallbackUrl", () => {
  it("lands on /auth/callback with the destination carried as `next`", () => {
    const url = new URL(
      buildAuthCallbackUrl("https://app.frapp.live", "/join?token=abc"),
    );
    expect(url.origin).toBe("https://app.frapp.live");
    expect(url.pathname).toBe(AUTH_CALLBACK_PATH);
    expect(url.searchParams.get("next")).toBe("/join?token=abc");
  });

  it("applies the open-redirect guard to `next` before it ever reaches the email", () => {
    const url = new URL(
      buildAuthCallbackUrl("https://app.frapp.live", "https://evil.example/x"),
    );
    expect(url.searchParams.get("next")).toBe("/chat");
  });
});

describe("describeAuthError", () => {
  it("has member-facing wording for every code the callback emits", () => {
    for (const code of [
      "otp_expired",
      "access_denied",
      "otp_disabled",
      "exchange_failed",
      "verify_failed",
      "missing_code",
      "identity_already_exists",
      "user_already_exists",
      "email_exists",
    ]) {
      expect(describeAuthError(code)).not.toMatch(
        /^Request a new link below, or sign in/,
      );
    }
    expect(describeAuthError("something_else")).toMatch(/Request a new link/);
  });

  it("uses the same identity-collision copy as OAuth kickoff", () => {
    expect(describeAuthError("identity_already_exists")).toBe(
      IDENTITY_COLLISION_COPY,
    );
    expect(describeAuthError("user_already_exists")).toBe(
      IDENTITY_COLLISION_COPY,
    );
    expect(describeAuthError("email_exists")).toBe(IDENTITY_COLLISION_COPY);
  });
});
