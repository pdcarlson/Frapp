import { afterEach, beforeEach, describe, expect, test } from "vitest";

const SUPABASE_ENV_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
] as const;

describe("apps/web/proxy.ts", () => {
  const originalEnv: Partial<Record<(typeof SUPABASE_ENV_KEYS)[number], string | undefined>> = {};

  beforeEach(() => {
    for (const key of SUPABASE_ENV_KEYS) {
      originalEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of SUPABASE_ENV_KEYS) {
      const prior = originalEnv[key];
      if (prior === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = prior;
      }
    }
  });

  test("module imports without Supabase env vars set", async () => {
    // Regression: previously `createServerClient` was called at module
    // load, which crashed the CI Playwright webServer (no secrets in that
    // job). The proxy must be importable anywhere — env reads happen per
    // request, not at import time.
    const mod = await import("../proxy");
    expect(typeof mod.proxy).toBe("function");
    expect(mod.config).toMatchObject({
      matcher: expect.arrayContaining(["/", "/sign-in", "/sign-up"]),
    });
  });

  test("proxy() returns a passthrough NextResponse when env is missing", async () => {
    const { proxy } = await import("../proxy");
    const { NextRequest } = await import("next/server");

    const request = new NextRequest("https://app.example.com/members");
    const response = await proxy(request);

    // Without env vars the proxy cannot make auth decisions; it must not
    // throw and must not redirect — the request is passed through so the
    // page itself can render (this is only hit in CI-shaped environments).
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });
});
