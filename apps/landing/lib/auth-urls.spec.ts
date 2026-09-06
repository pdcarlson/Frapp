import { describe, expect, it } from "vitest";
import { buildAuthUrls } from "./auth-urls";

describe("buildAuthUrls", () => {
  it("targets the real web auth routes for an explicit base URL", () => {
    const { signupUrl, loginUrl } = buildAuthUrls("https://app.example.com");

    expect(signupUrl).toBe("https://app.example.com/sign-up");
    expect(loginUrl).toBe("https://app.example.com/sign-in");
  });

  it("falls back to the production app origin when no base is provided", () => {
    const fromUndefined = buildAuthUrls(undefined);
    const fromNull = buildAuthUrls(null);

    expect(fromUndefined.signupUrl).toBe("https://app.frapp.live/sign-up");
    expect(fromUndefined.loginUrl).toBe("https://app.frapp.live/sign-in");
    expect(fromNull).toEqual(fromUndefined);
  });

  it("never emits the non-existent /login or bare /signup routes", () => {
    for (const base of [
      undefined,
      "https://app.frapp.live",
      "https://app.frapp.live/",
      "https://staging.frapp.live/sign-up",
      // Multi-segment, and load-bearing: against a single-segment base a
      // relative "sign-up" resolves to the same string as an absolute
      // "/sign-up", so this is the only entry that catches the two path
      // constants losing their leading slash — which would ship a 404 CTA.
      "https://staging.frapp.live/a/b",
    ]) {
      const { signupUrl, loginUrl } = buildAuthUrls(base);
      const { pathname: signupPath } = new URL(signupUrl);
      const { pathname: loginPath } = new URL(loginUrl);

      expect(signupPath).toBe("/sign-up");
      expect(loginPath).toBe("/sign-in");
    }
  });

  it("drops the base's path but keeps its origin and userinfo", () => {
    expect(buildAuthUrls("https://app.frapp.live/").signupUrl).toBe(
      "https://app.frapp.live/sign-up",
    );
    expect(buildAuthUrls("https://app.frapp.live/sign-up").loginUrl).toBe(
      "https://app.frapp.live/sign-in",
    );
    // Userinfo is the one part of the base that survives, so a credentialed
    // base is rendered into a public href. Pinned rather than left incidental.
    expect(buildAuthUrls("https://u:p@app.frapp.live/x").signupUrl).toBe(
      "https://u:p@app.frapp.live/sign-up",
    );
  });
});
