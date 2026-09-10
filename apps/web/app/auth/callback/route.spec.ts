import { beforeEach, describe, expect, it, vi } from "vitest";

const exchangeCodeForSession = vi.fn();
const verifyOtp = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => ({
    auth: { exchangeCodeForSession, verifyOtp },
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
    verifyOtp.mockReset();
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
    expect(verifyOtp).not.toHaveBeenCalled();
    expect(url.searchParams.get("authError")).toBe("missing_code");
  });

  it("verifies a token_hash on this host and sends the member on to `next`", async () => {
    verifyOtp.mockResolvedValue({ error: null });
    const { status, url } = await callback(
      "token_hash=pkce_hash&type=magiclink&next=%2Fjoin%3Ftoken%3Dinv-1",
    );
    expect(verifyOtp).toHaveBeenCalledWith({
      token_hash: "pkce_hash",
      type: "magiclink",
    });
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    expect(status).toBeGreaterThanOrEqual(300);
    expect(url.origin).toBe(ORIGIN);
    expect(url.pathname).toBe("/join");
    expect(url.searchParams.get("token")).toBe("inv-1");
  });

  it("refuses a crafted token_hash type before calling Auth", async () => {
    const { url } = await callback("token_hash=pkce_hash&type=not-a-type");
    expect(verifyOtp).not.toHaveBeenCalled();
    expect(url.pathname).toBe("/sign-in");
    expect(url.searchParams.get("authError")).toBe("verify_failed");
  });

  it("passes an OAuth identity collision through without exchanging a code", async () => {
    const { url } = await callback(
      "error=server_error&error_code=identity_already_exists&next=%2Fchat",
    );
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    expect(url.pathname).toBe("/sign-in");
    expect(url.searchParams.get("authError")).toBe("identity_already_exists");
  });

  it("sends a failed hash verify to sign-in without attempting a PKCE exchange", async () => {
    verifyOtp.mockResolvedValue({ error: { message: "otp_expired" } });
    const { url } = await callback("token_hash=stale&type=magiclink&next=%2Fchat");
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    expect(url.pathname).toBe("/sign-in");
    expect(url.searchParams.get("authError")).toBe("verify_failed");
  });
});
