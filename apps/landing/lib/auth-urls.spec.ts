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
    ]) {
      const { signupUrl, loginUrl } = buildAuthUrls(base);
      const { pathname: signupPath } = new URL(signupUrl);
      const { pathname: loginPath } = new URL(loginUrl);

      expect(signupPath).toBe("/sign-up");
      expect(loginPath).toBe("/sign-in");
    }
  });

  it("strips a trailing slash and an accidental /sign-up suffix on the base", () => {
    expect(buildAuthUrls("https://app.frapp.live/").signupUrl).toBe(
      "https://app.frapp.live/sign-up",
    );
    expect(buildAuthUrls("https://app.frapp.live/sign-up").loginUrl).toBe(
      "https://app.frapp.live/sign-in",
    );
  });
});
