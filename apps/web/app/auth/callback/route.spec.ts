import { beforeEach, describe, expect, it, vi } from "vitest";

const exchangeCodeForSession = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => ({
    auth: { exchangeCodeForSession },
  })),
}));

import { GET } from "./route";

const ORIGIN = "https://app.frapp.live";

async function callback(query: string) {
  const response = await GET(new Request(`${ORIGIN}/auth/callback?${query}`));
  const location = response.headers.get("location");
  expect(location).not.toBeNull();
  return { status: response.status, url: new URL(location as string) };
}

describe("GET /auth/callback", () => {
  beforeEach(() => {
    exchangeCodeForSession.mockReset();
  });

  it("exchanges the PKCE code and sends the member on to `next`, signed in", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null });
    const { status, url } = await callback("code=abc123&next=%2Fjoin%3Ftoken%3Dinv-1");
    expect(exchangeCodeForSession).toHaveBeenCalledWith("abc123");
    expect(status).toBeGreaterThanOrEqual(300);
    expect(url.origin).toBe(ORIGIN);
    expect(url.pathname).toBe("/join");
    expect(url.searchParams.get("token")).toBe("inv-1");
  });

  it("defaults `next` to the dashboard", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null });
    const { url } = await callback("code=abc123");
    expect(url.pathname).toBe("/chat");
  });

  it("never redirects off-origin, however `next` is shaped", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null });
    for (const next of ["https://evil.example/x", "//evil.example/x", "/\\evil.example/x", "evil"]) {
      const { url } = await callback(`code=abc123&next=${encodeURIComponent(next)}`);
      expect(url.origin).toBe(ORIGIN);
      expect(url.pathname).toBe("/chat");
    }
  });

  it("sends a failed exchange to sign-in with the destination and the reason", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: { message: "invalid code" } });
    const { url } = await callback("code=stale&next=%2Fjoin%3Ftoken%3Dinv-1");
    expect(url.pathname).toBe("/sign-in");
    expect(url.searchParams.get("redirectTo")).toBe("/join?token=inv-1");
    expect(url.searchParams.get("authError")).toBe("exchange_failed");
  });

  it("passes GoTrue's own error code through without attempting an exchange", async () => {
    const { url } = await callback(
      "error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired&next=%2Fchat",
    );
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    expect(url.pathname).toBe("/sign-in");
    expect(url.searchParams.get("authError")).toBe("otp_expired");
  });

  it("treats a link with no code as incomplete", async () => {
    const { url } = await callback("next=%2Fchat");
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    expect(url.searchParams.get("authError")).toBe("missing_code");
  });
});
