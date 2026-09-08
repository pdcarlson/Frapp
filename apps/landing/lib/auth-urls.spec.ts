import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildAuthUrls, buildJoinUrl } from "./auth-urls";

const originalVercelEnv = process.env.VERCEL_ENV;

beforeEach(() => {
  delete process.env.VERCEL_ENV;
});

afterAll(() => {
  if (originalVercelEnv === undefined) {
    delete process.env.VERCEL_ENV;
  } else {
    process.env.VERCEL_ENV = originalVercelEnv;
  }
});

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

  it("drops the base's path but keeps its origin", () => {
    expect(buildAuthUrls("https://app.frapp.live/").signupUrl).toBe(
      "https://app.frapp.live/sign-up",
    );
    expect(buildAuthUrls("https://app.frapp.live/sign-up").loginUrl).toBe(
      "https://app.frapp.live/sign-in",
    );
  });

  it("strips userinfo rather than rendering it into a public href", () => {
    // `new URL` preserves userinfo, so without the strip a credentialed base
    // reaches every CTA in server-rendered HTML.
    expect(buildAuthUrls("https://u:p@app.frapp.live/x").signupUrl).toBe(
      "https://app.frapp.live/sign-up",
    );
    expect(buildAuthUrls("https://u:p@app.frapp.live/x").loginUrl).toBe(
      "https://app.frapp.live/sign-in",
    );
    expect(buildAuthUrls("https://user@app.frapp.live").signupUrl).toBe(
      "https://app.frapp.live/sign-up",
    );
  });

  it("refuses production Vercel CTAs pointed at staging", () => {
    expect(() =>
      buildAuthUrls("https://app.staging.frapp.live", {
        vercelEnv: "production",
      }),
    ).toThrow(/NEXT_PUBLIC_APP_URL[\s\S]*app\.staging\.frapp\.live/);
  });

  it("allows production Vercel CTAs when the base is unset or the production origin", () => {
    expect(
      buildAuthUrls(undefined, { vercelEnv: "production" }).signupUrl,
    ).toBe("https://app.frapp.live/sign-up");
    expect(
      buildAuthUrls("https://app.frapp.live/", { vercelEnv: "production" })
        .loginUrl,
    ).toBe("https://app.frapp.live/sign-in");
  });
});

describe("buildJoinUrl", () => {
  it("falls back to the production app origin when no base is provided", () => {
    expect(buildJoinUrl(undefined)).toBe("https://app.frapp.live/join");
    expect(buildJoinUrl(null)).toBe("https://app.frapp.live/join");
  });

  it("keeps the invite query on the web app origin", () => {
    expect(
      buildJoinUrl("https://app.example.com", { token: "abc123" }),
    ).toBe("https://app.example.com/join?token=abc123");
    expect(
      buildJoinUrl("https://app.frapp.live", "?invite=from-alias"),
    ).toBe("https://app.frapp.live/join?invite=from-alias");
    expect(
      buildJoinUrl(
        "https://app.staging.frapp.live",
        new URLSearchParams("code=xyz"),
      ),
    ).toBe("https://app.staging.frapp.live/join?code=xyz");
  });

  it("strips userinfo and a base path the same way auth CTAs do", () => {
    expect(buildJoinUrl("https://u:p@app.frapp.live/x", { token: "t" })).toBe(
      "https://app.frapp.live/join?token=t",
    );
  });

  it("skips empty query values so a blank token= does not poison the redirect", () => {
    expect(
      buildJoinUrl("https://app.frapp.live", { token: "", invite: "kept" }),
    ).toBe("https://app.frapp.live/join?invite=kept");
  });

  it("refuses a public http: base before attaching the invite token", () => {
    expect(() =>
      buildJoinUrl("http://app.frapp.live", { token: "secret-invite" }),
    ).toThrow(/must use https:/);
    expect(() =>
      buildJoinUrl("http://app.example.com", { token: "secret-invite" }),
    ).toThrow(/NEXT_PUBLIC_APP_URL[\s\S]*http:\/\/app\.example\.com/);
    // The throw happens before the query is copied, so the token is not in
    // the error either — a 500 page must not echo it.
    try {
      buildJoinUrl("http://app.frapp.live", { token: "secret-invite" });
      throw new Error("expected refuse");
    } catch (error) {
      expect(String(error)).not.toContain("secret-invite");
    }
  });

  it("allows loopback http: so local Infisical APP_URL still redirects", () => {
    expect(
      buildJoinUrl("http://localhost:3000", { token: "local-token" }),
    ).toBe("http://localhost:3000/join?token=local-token");
    expect(
      buildJoinUrl("http://127.0.0.1:3000", { token: "local-token" }),
    ).toBe("http://127.0.0.1:3000/join?token=local-token");
    expect(
      buildJoinUrl("http://[::1]:3000", { token: "local-token" }),
    ).toBe("http://[::1]:3000/join?token=local-token");
    expect(() =>
      buildJoinUrl("http://app.localhost", { token: "secret-invite" }),
    ).toThrow(/must use https:/);
  });

  it("refuses a production Vercel deploy pointed at staging before copying the token", () => {
    expect(() =>
      buildJoinUrl(
        "https://app.staging.frapp.live",
        { token: "secret-invite" },
        { vercelEnv: "production" },
      ),
    ).toThrow(/NEXT_PUBLIC_APP_URL[\s\S]*app\.staging\.frapp\.live/);
    try {
      buildJoinUrl(
        "https://app.staging.frapp.live",
        { token: "secret-invite" },
        { vercelEnv: "production" },
      );
      throw new Error("expected refuse");
    } catch (error) {
      expect(String(error)).not.toContain("secret-invite");
    }
  });

  it("still allows a preview deploy to forward to staging", () => {
    expect(
      buildJoinUrl(
        "https://app.staging.frapp.live",
        { token: "staging-token" },
        { vercelEnv: "preview" },
      ),
    ).toBe("https://app.staging.frapp.live/join?token=staging-token");
  });

  it("allows a production Vercel deploy when the base is the production origin or unset", () => {
    expect(
      buildJoinUrl(undefined, { token: "prod-token" }, { vercelEnv: "production" }),
    ).toBe("https://app.frapp.live/join?token=prod-token");
    expect(
      buildJoinUrl("https://app.frapp.live/", { token: "prod-token" }, {
        vercelEnv: "production",
      }),
    ).toBe("https://app.frapp.live/join?token=prod-token");
  });
});
