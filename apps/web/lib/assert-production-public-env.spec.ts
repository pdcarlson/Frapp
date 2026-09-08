import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PRODUCTION_API_ORIGIN as SHARED_PRODUCTION_API_ORIGIN,
  PRODUCTION_SUPABASE_PROJECT_REF as SHARED_PRODUCTION_SUPABASE_PROJECT_REF,
} from "@repo/validation";
import { describe, expect, it } from "vitest";
import {
  PRODUCTION_API_ORIGIN,
  PRODUCTION_SUPABASE_PROJECT_REF,
  assertProductionWebPublicEnv,
} from "./assert-production-public-env.js";

const productionSupabase = `https://${PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co`;

const here = dirname(fileURLToPath(import.meta.url));

describe("assert-production-public-env constants", () => {
  it("match @repo/validation so next.config.js cannot drift from the shared fence", () => {
    expect(PRODUCTION_API_ORIGIN).toBe(SHARED_PRODUCTION_API_ORIGIN);
    expect(PRODUCTION_SUPABASE_PROJECT_REF).toBe(
      SHARED_PRODUCTION_SUPABASE_PROJECT_REF,
    );
  });

  it("is wired from next.config.js so a production Vercel build cannot skip it", () => {
    const config = readFileSync(join(here, "../next.config.js"), "utf8");
    expect(config).toMatch(/assertProductionWebPublicEnv/);
  });
});

describe("assertProductionWebPublicEnv", () => {
  it("skips when VERCEL_ENV is unset, preview, or development", () => {
    const bad = {
      apiUrl: "http://localhost:3001",
      supabaseUrl: "http://127.0.0.1:54321",
    };
    expect(() => assertProductionWebPublicEnv(bad)).not.toThrow();
    expect(() =>
      assertProductionWebPublicEnv({ ...bad, vercelEnv: "preview" }),
    ).not.toThrow();
    expect(() =>
      assertProductionWebPublicEnv({ ...bad, vercelEnv: "development" }),
    ).not.toThrow();
  });

  it("allows the production origins, ignoring a trailing slash", () => {
    expect(() =>
      assertProductionWebPublicEnv({
        vercelEnv: "production",
        apiUrl: `${PRODUCTION_API_ORIGIN}/`,
        supabaseUrl: `${productionSupabase}/`,
      }),
    ).not.toThrow();
  });

  it("refuses empty, localhost, and staging API URLs", () => {
    const supabaseUrl = productionSupabase;
    expect(() =>
      assertProductionWebPublicEnv({
        vercelEnv: "production",
        apiUrl: "",
        supabaseUrl,
      }),
    ).toThrow(/NEXT_PUBLIC_API_URL[\s\S]*empty/);
    expect(() =>
      assertProductionWebPublicEnv({
        vercelEnv: "production",
        supabaseUrl,
      }),
    ).toThrow(/NEXT_PUBLIC_API_URL[\s\S]*empty/);
    expect(() =>
      assertProductionWebPublicEnv({
        vercelEnv: "production",
        apiUrl: "http://localhost:3001",
        supabaseUrl,
      }),
    ).toThrow(/localhost/);
    expect(() =>
      assertProductionWebPublicEnv({
        vercelEnv: "production",
        apiUrl: "https://api-staging.frapp.live",
        supabaseUrl,
      }),
    ).toThrow(/api-staging\.frapp\.live/);
  });

  it("refuses empty, localhost, and staging Supabase URLs", () => {
    const apiUrl = PRODUCTION_API_ORIGIN;
    expect(() =>
      assertProductionWebPublicEnv({
        vercelEnv: "production",
        apiUrl,
        supabaseUrl: "",
      }),
    ).toThrow(/NEXT_PUBLIC_SUPABASE_URL[\s\S]*empty/);
    expect(() =>
      assertProductionWebPublicEnv({
        vercelEnv: "production",
        apiUrl,
        supabaseUrl: "http://127.0.0.1:54321",
      }),
    ).toThrow(/127\.0\.0\.1/);
    expect(() =>
      assertProductionWebPublicEnv({
        vercelEnv: "production",
        apiUrl,
        supabaseUrl: "https://hnoyzpidbmizhbqaiity.supabase.co",
      }),
    ).toThrow(/hnoyzpidbmizhbqaiity/);
  });

  it("refuses a query-host spoof without echoing a token", () => {
    try {
      assertProductionWebPublicEnv({
        vercelEnv: "production",
        apiUrl: `${PRODUCTION_API_ORIGIN}/v1?token=secret-invite`,
        supabaseUrl: `https://evil.example/?host=${PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co&token=secret-invite`,
      });
      throw new Error("expected refuse");
    } catch (error) {
      expect(String(error)).not.toContain("secret-invite");
      expect(String(error)).toMatch(/NEXT_PUBLIC_SUPABASE_URL/);
    }
  });
});
