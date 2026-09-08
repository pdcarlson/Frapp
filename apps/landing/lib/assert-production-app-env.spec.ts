import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PRODUCTION_APP_ORIGIN as SHARED_PRODUCTION_APP_ORIGIN } from "@repo/validation";
import { describe, expect, it } from "vitest";
import {
  PRODUCTION_APP_ORIGIN,
  assertProductionLandingAppEnv,
} from "./assert-production-app-env.js";

const here = dirname(fileURLToPath(import.meta.url));

describe("assert-production-app-env constants", () => {
  it("match @repo/validation so next.config.js cannot drift from the shared fence", () => {
    expect(PRODUCTION_APP_ORIGIN).toBe(SHARED_PRODUCTION_APP_ORIGIN);
  });

  it("is wired from next.config.js so a production Vercel build cannot skip it", () => {
    const config = readFileSync(join(here, "../next.config.js"), "utf8");
    expect(config).toMatch(/assertProductionLandingAppEnv/);
  });
});

describe("assertProductionLandingAppEnv", () => {
  it("skips when VERCEL_ENV is unset, preview, or development", () => {
    expect(() =>
      assertProductionLandingAppEnv({
        appUrl: "https://app.staging.frapp.live",
      }),
    ).not.toThrow();
    expect(() =>
      assertProductionLandingAppEnv({
        vercelEnv: "preview",
        appUrl: "https://app.staging.frapp.live",
      }),
    ).not.toThrow();
    expect(() =>
      assertProductionLandingAppEnv({
        vercelEnv: "development",
        appUrl: "http://localhost:3000",
      }),
    ).not.toThrow();
  });

  it("allows unset so request-time fallback still applies", () => {
    expect(() =>
      assertProductionLandingAppEnv({ vercelEnv: "production" }),
    ).not.toThrow();
    expect(() =>
      assertProductionLandingAppEnv({
        vercelEnv: "production",
        appUrl: undefined,
      }),
    ).not.toThrow();
  });

  it("allows the production origin, ignoring a trailing slash", () => {
    expect(() =>
      assertProductionLandingAppEnv({
        vercelEnv: "production",
        appUrl: `${PRODUCTION_APP_ORIGIN}/`,
      }),
    ).not.toThrow();
  });

  it("refuses empty, staging, and localhost without echoing a token", () => {
    expect(() =>
      assertProductionLandingAppEnv({
        vercelEnv: "production",
        appUrl: "",
      }),
    ).toThrow(/NEXT_PUBLIC_APP_URL[\s\S]*empty/);
    expect(() =>
      assertProductionLandingAppEnv({
        vercelEnv: "production",
        appUrl: "https://app.staging.frapp.live",
      }),
    ).toThrow(/app\.staging\.frapp\.live/);
    expect(() =>
      assertProductionLandingAppEnv({
        vercelEnv: "production",
        appUrl: "http://localhost:3000",
      }),
    ).toThrow(/localhost/);
    try {
      assertProductionLandingAppEnv({
        vercelEnv: "production",
        appUrl: "https://app.staging.frapp.live/join?token=secret-invite",
      });
      throw new Error("expected refuse");
    } catch (error) {
      expect(String(error)).not.toContain("secret-invite");
    }
  });
});
