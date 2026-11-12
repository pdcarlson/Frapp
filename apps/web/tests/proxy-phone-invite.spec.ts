import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

/**
 * `proxy()` itself, signed out, with Supabase configured (#4002): the phone
 * exemption is wired into the redirect, not only defined. `getSession` is
 * stubbed to answer "no session" so no network is touched.
 */
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getSession: async () => ({ data: { session: null } }) },
  }),
}));

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1";

describe("proxy(): a signed-out invite link on a phone (#4002)", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "sb_publishable_test");
    vi.stubEnv("SUPABASE_AUTH_BYPASS", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  async function visit(url: string, ua?: string) {
    const { proxy } = await import("../proxy");
    const { NextRequest } = await import("next/server");
    return proxy(
      new NextRequest(url, ua ? { headers: { "user-agent": ua } } : undefined),
    );
  }

  test("reaches /join instead of bouncing to sign-in", async () => {
    const response = await visit(
      "https://app.frapp.live/join?token=abc",
      IPHONE,
    );
    expect(response.headers.get("location")).toBeNull();
  });

  test("bounces as before once the visitor chose the browser", async () => {
    const response = await visit(
      "https://app.frapp.live/join?token=abc&web=1",
      IPHONE,
    );
    expect(response.headers.get("location")).toBe(
      "https://app.frapp.live/sign-in?redirectTo=%2Fjoin%3Ftoken%3Dabc%26web%3D1",
    );
  });

  test("bounces a desktop, and any other gated page on a phone", async () => {
    expect(
      (await visit("https://app.frapp.live/join?token=abc")).headers.get(
        "location",
      ),
    ).toContain("/sign-in?redirectTo=");
    expect(
      (
        await visit("https://app.frapp.live/chat?token=abc", IPHONE)
      ).headers.get("location"),
    ).toContain("/sign-in?redirectTo=");
  });
});
