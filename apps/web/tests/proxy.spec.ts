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

  test("matcher gates every protected and auth route, skipping only dashboard prefetches", async () => {
    // Compiled by Next's own build-time matcher code, so this checks what a
    // deployment actually runs, not a hand-copied regex.
    const { config, PROTECTED_ROUTE_PREFIXES, AUTH_ROUTES } = await import(
      "../proxy"
    );
    // Internal Next module: it exports this at runtime, but its type
    // declarations leave it out.
    const { getMiddlewareMatchers } = (await import(
      "next/dist/build/analysis/get-page-static-info.js"
    )) as unknown as {
      getMiddlewareMatchers: (
        matcher: unknown,
        nextConfig: { basePath: string; i18n: undefined },
      ) => { regexp: string; missing?: unknown[] }[];
    };
    const compiled = getMiddlewareMatchers(config.matcher, {
      basePath: "",
      i18n: undefined,
    }).map((m) => ({ re: new RegExp(m.regexp), skipsPrefetch: !!m.missing }));
    const onNavigation = (path: string) => compiled.some((m) => m.re.test(path));
    const onPrefetch = (path: string) =>
      compiled.some((m) => !m.skipsPrefetch && m.re.test(path));

    // Static routes: Next reuses their prefetch as the navigation, so the
    // proxy must run on the prefetch too.
    const staticRoutes = ["/", ...AUTH_ROUTES, "/join", "/no-access", "/new-account", "/dashboard"];
    for (const path of staticRoutes) {
      expect(onNavigation(path), path).toBe(true);
      expect(onPrefetch(path), path).toBe(true);
    }
    expect(onNavigation("/index.rsc"), "/index.rsc").toBe(true);

    const dynamicPrefixes = PROTECTED_ROUTE_PREFIXES.filter(
      (prefix) => !staticRoutes.includes(prefix),
    );
    expect(dynamicPrefixes.length).toBeGreaterThan(15);
    for (const prefix of dynamicPrefixes) {
      for (const path of [prefix, `${prefix}/x`]) {
        expect(onNavigation(path), path).toBe(true);
        expect(onPrefetch(path), path).toBe(false);
      }
      expect(onNavigation(`${prefix}x`), `${prefix}x`).toBe(false);
    }

    for (const path of ["/robots.txt", "/auth/callback", "/_next/static/a.js"]) {
      expect(onNavigation(path), path).toBe(false);
    }
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

  test("unsigned /join?token= bounce keeps the invite only inside redirectTo", async () => {
    const { buildSignInRedirectUrl } = await import("../proxy");
    const inbound = new URL("https://app.frapp.live/join?token=abc");
    const out = buildSignInRedirectUrl(inbound);

    expect(out.origin).toBe("https://app.frapp.live");
    expect(out.pathname).toBe("/sign-in");
    expect(out.searchParams.get("redirectTo")).toBe("/join?token=abc");
    expect(out.searchParams.get("token")).toBeNull();
    expect([...out.searchParams.keys()]).toEqual(["redirectTo"]);
  });

  test("unsigned bounce drops every inbound query key, not only token", async () => {
    const { buildSignInRedirectUrl } = await import("../proxy");
    const inbound = new URL(
      "https://app.frapp.live/join?token=abc&utm_source=officer#frag",
    );
    const out = buildSignInRedirectUrl(inbound);

    expect(out.hash).toBe("");
    expect(out.searchParams.get("utm_source")).toBeNull();
    expect(out.searchParams.get("redirectTo")).toBe(
      "/join?token=abc&utm_source=officer",
    );
  });
});
