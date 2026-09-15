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

/** A legacy-format (JWT) Supabase anon key whose `ref` claim names `ref`. */
const anonKeyForProject = (ref: string, role = "anon") =>
  [
    Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
      "base64url",
    ),
    Buffer.from(JSON.stringify({ iss: "supabase", ref, role })).toString(
      "base64url",
    ),
    "not-a-real-signature",
  ].join(".");

const productionAnonKey = anonKeyForProject(PRODUCTION_SUPABASE_PROJECT_REF);

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
        supabaseAnonKey: productionAnonKey,
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
  it("refuses a missing anon key — the defect that let runs 34896647837 and 34905005744 reach prerender", () => {
    const base = {
      vercelEnv: "production",
      apiUrl: PRODUCTION_API_ORIGIN,
      supabaseUrl: productionSupabase,
    };
    // Exactly the shape of the failing production runs: both URLs correct,
    // anon key absent. Before this check the guard passed here and the build
    // died ~30s later in `lib/supabase/server.ts` while prerendering `/`.
    expect(() => assertProductionWebPublicEnv(base)).toThrow(
      /NEXT_PUBLIC_SUPABASE_ANON_KEY[\s\S]*empty/,
    );
    expect(() =>
      assertProductionWebPublicEnv({ ...base, supabaseAnonKey: "" }),
    ).toThrow(/NEXT_PUBLIC_SUPABASE_ANON_KEY/);
    expect(() =>
      assertProductionWebPublicEnv({ ...base, supabaseAnonKey: "   " }),
    ).toThrow(/NEXT_PUBLIC_SUPABASE_ANON_KEY/);
  });

  it("names the Infisical remedy, because the build log is where this is read", () => {
    try {
      assertProductionWebPublicEnv({
        vercelEnv: "production",
        apiUrl: PRODUCTION_API_ORIGIN,
        supabaseUrl: productionSupabase,
      });
      throw new Error("expected refuse");
    } catch (error) {
      expect(String(error)).toMatch(/\$\{SUPABASE_ANON_KEY\}/);
      expect(String(error)).toMatch(/NEXT_PUBLIC_/);
    }
  });

  it("refuses an anon key minted for a different Supabase project", () => {
    expect(() =>
      assertProductionWebPublicEnv({
        vercelEnv: "production",
        apiUrl: PRODUCTION_API_ORIGIN,
        supabaseUrl: productionSupabase,
        // The staging project ref — a production URL paired with the staging
        // anon key, which the URL fences alone cannot see.
        supabaseAnonKey: anonKeyForProject("hnoyzpidbmizhbqaiity"),
      }),
    ).toThrow(/hnoyzpidbmizhbqaiity[\s\S]*unttyvyfezddlyafcydh/);
  });

  it("never echoes the anon key itself", () => {
    const secretish = anonKeyForProject("hnoyzpidbmizhbqaiity");
    try {
      assertProductionWebPublicEnv({
        vercelEnv: "production",
        apiUrl: PRODUCTION_API_ORIGIN,
        supabaseUrl: productionSupabase,
        supabaseAnonKey: secretish,
      });
      throw new Error("expected refuse");
    } catch (error) {
      expect(String(error)).not.toContain(secretish);
    }
  });

  it("accepts a `sb_publishable_` key, which carries no project reference", () => {
    // `sb_publishable_…` carries no project reference, so there is nothing to
    // pin it to. It must not be rejected for failing a check that cannot apply.
    expect(() =>
      assertProductionWebPublicEnv({
        vercelEnv: "production",
        apiUrl: PRODUCTION_API_ORIGIN,
        supabaseUrl: productionSupabase,
        supabaseAnonKey: "sb_publishable_not-a-real-key",
      }),
    ).not.toThrow();
  });

  it("still skips the anon key check outside production", () => {
    expect(() =>
      assertProductionWebPublicEnv({
        vercelEnv: "preview",
        apiUrl: "http://localhost:3001",
        supabaseUrl: "http://127.0.0.1:54321",
      }),
    ).not.toThrow();
  });
  it("refuses a service-role key — it would be inlined into the browser bundle", () => {
    // SUPABASE_SERVICE_ROLE_KEY sits at the same Infisical path, one row from
    // the anon key in ENV_REFERENCE.md's table, and is a JWT for the SAME
    // project ref. A ref-only check passes it, and Next then publishes an
    // RLS-bypass credential to every visitor.
    expect(() =>
      assertProductionWebPublicEnv({
        vercelEnv: "production",
        apiUrl: PRODUCTION_API_ORIGIN,
        supabaseUrl: productionSupabase,
        supabaseAnonKey: anonKeyForProject(
          PRODUCTION_SUPABASE_PROJECT_REF,
          "service_role",
        ),
      }),
    ).toThrow(/service_role[\s\S]*not an anon key/);
  });

  it("refuses an `sb_secret_` key, the new-format service-role twin", () => {
    expect(() =>
      assertProductionWebPublicEnv({
        vercelEnv: "production",
        apiUrl: PRODUCTION_API_ORIGIN,
        supabaseUrl: productionSupabase,
        supabaseAnonKey: "sb_secret_placeholder-value",
      }),
    ).toThrow(/SECRET key/);
  });

  it("refuses an unresolved reference, a pasted URL, and junk", () => {
    const base = {
      vercelEnv: "production",
      apiUrl: PRODUCTION_API_ORIGIN,
      supabaseUrl: productionSupabase,
    };
    // Each is non-empty, so the old presence check and `server.ts`'s
    // `!anonKey` both pass it: the build goes green and every Supabase
    // request 401s at runtime, with no build-time signal at all.
    expect(() =>
      assertProductionWebPublicEnv({
        ...base,
        supabaseAnonKey: "${SUPABASE_ANON_KEY}",
      }),
    ).toThrow(/unresolved variable reference/);
    expect(() =>
      assertProductionWebPublicEnv({
        ...base,
        supabaseAnonKey: productionSupabase,
      }),
    ).toThrow(/looks like a URL/);
    expect(() =>
      assertProductionWebPublicEnv({ ...base, supabaseAnonKey: "changeme" }),
    ).toThrow(/not a recognized Supabase key/);
  });

  it("accepts a legacy anon key carrying no `ref` claim rather than guessing", () => {
    expect(() =>
      assertProductionWebPublicEnv({
        vercelEnv: "production",
        apiUrl: PRODUCTION_API_ORIGIN,
        supabaseUrl: productionSupabase,
        supabaseAnonKey: [
          Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url"),
          Buffer.from(
            JSON.stringify({ iss: "supabase-demo", role: "anon" }),
          ).toString("base64url"),
          "not-a-real-signature",
        ].join("."),
      }),
    ).not.toThrow();
  });

  it("reports EVERY wrong variable in one throw, so one attempt names them all", () => {
    // Fail-fast costs a typed `DEPLOY TO PRODUCTION` and a fresh reviewer
    // Approve per variable; the three 2026-09-14 attempts each burned one.
    let message = "";
    try {
      assertProductionWebPublicEnv({ vercelEnv: "production" });
    } catch (error) {
      message = String(error);
    }
    expect(message).toMatch(/NEXT_PUBLIC_API_URL/);
    expect(message).toMatch(/NEXT_PUBLIC_SUPABASE_URL/);
    expect(message).toMatch(/NEXT_PUBLIC_SUPABASE_ANON_KEY/);
    expect(message).toMatch(/3 production environment variables/);
  });

  it("throws the bare message, not a numbered list, when only one is wrong", () => {
    let message = "";
    try {
      assertProductionWebPublicEnv({
        vercelEnv: "production",
        apiUrl: PRODUCTION_API_ORIGIN,
        supabaseUrl: productionSupabase,
      });
    } catch (error) {
      message = String(error);
    }
    expect(message).toMatch(/NEXT_PUBLIC_SUPABASE_ANON_KEY/);
    expect(message).not.toMatch(/environment variables are wrong/);
  });
});
