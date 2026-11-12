import { describe, expect, it, vi } from "vitest";
import {
  TOKEN_EXPIRY_MARGIN_MS,
  accessTokenTimes,
  createFreshAuthTokenReader,
} from "./fresh-auth-token";

const NOW = 1_800_000_000_000;

/** An unsigned JWT-shaped token carrying `exp` (and `iat`, when given). */
function tokenExpiringAt(ms: number, issuedMs?: number): string {
  const claims: Record<string, number> = { exp: Math.floor(ms / 1000) };
  if (issuedMs !== undefined) claims.iat = Math.floor(issuedMs / 1000);
  const payload = btoa(JSON.stringify(claims))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `e30.${payload}.sig`;
}

function fakeSupabase(
  result: () => Promise<{ data: { session: unknown }; error: unknown }>,
) {
  return { auth: { getSession: vi.fn(result) } };
}

function reader(token: string | null, supabase: unknown) {
  return createFreshAuthTokenReader({
    readToken: async () => token,
    getSupabase: () => supabase as never,
    now: () => NOW,
  });
}

describe("accessTokenTimes", () => {
  it("reads exp and iat from a base64url payload", () => {
    expect(accessTokenTimes(tokenExpiringAt(NOW, NOW - 1_000))).toEqual({
      expiresAt: NOW,
      issuedAt: NOW - 1_000,
    });
    expect(accessTokenTimes(tokenExpiringAt(NOW))?.issuedAt).toBeNull();
  });

  it("is null for anything that isn't a JWT with a numeric exp", () => {
    expect(accessTokenTimes("opaque")).toBeNull();
    expect(accessTokenTimes("a.!!!.c")).toBeNull();
    expect(accessTokenTimes(`e30.${btoa("{}")}.sig`)).toBeNull();
  });
});

describe("createFreshAuthTokenReader (#3907)", () => {
  it("hands on a token with time left, without asking Auth", async () => {
    const live = tokenExpiringAt(NOW + TOKEN_EXPIRY_MARGIN_MS + 60_000);
    const supabase = fakeSupabase(async () => ({
      data: { session: null },
      error: null,
    }));

    await expect(reader(live, supabase)()).resolves.toBe(live);
    expect(supabase.auth.getSession).not.toHaveBeenCalled();
  });

  it("refreshes an expired token before the request goes out", async () => {
    const stale = tokenExpiringAt(NOW - 60 * 60_000);
    const supabase = fakeSupabase(async () => ({
      data: { session: { access_token: "fresh" } },
      error: null,
    }));

    await expect(reader(stale, supabase)()).resolves.toBe("fresh");
  });

  it("refreshes a token inside the margin", async () => {
    const expiring = tokenExpiringAt(NOW + TOKEN_EXPIRY_MARGIN_MS - 1_000);
    const supabase = fakeSupabase(async () => ({
      data: { session: { access_token: "fresh" } },
      error: null,
    }));

    await expect(reader(expiring, supabase)()).resolves.toBe("fresh");
  });

  it("falls back to the mirrored token when the refresh fails", async () => {
    const stale = tokenExpiringAt(NOW - 1_000);
    const failed = fakeSupabase(async () => ({
      data: { session: null },
      error: new Error("network"),
    }));
    const threw = fakeSupabase(async () => {
      throw new Error("boom");
    });

    await expect(reader(stale, failed)()).resolves.toBe(stale);
    await expect(reader(stale, threw)()).resolves.toBe(stale);
  });

  it("sends no token once Auth says there is no session", async () => {
    const stale = tokenExpiringAt(NOW - 1_000);
    const supabase = fakeSupabase(async () => ({
      data: { session: null },
      error: null,
    }));

    await expect(reader(stale, supabase)()).resolves.toBeNull();
  });

  it("learns a fast device clock from one refresh, then stops refreshing", async () => {
    // The device runs two hours ahead of Auth. Auth issues 1h tokens, so by
    // the device's clock every token Auth hands out has already expired.
    const SKEW = 2 * 60 * 60_000;
    const authNow = NOW - SKEW;
    const issued = tokenExpiringAt(authNow + 60 * 60_000, authNow);
    let mirror = tokenExpiringAt(authNow - 1_000, authNow - 60 * 60_000);
    const supabase = fakeSupabase(async () => ({
      data: { session: { access_token: issued } },
      error: null,
    }));
    const read = createFreshAuthTokenReader({
      readToken: async () => mirror,
      getSupabase: () => supabase as never,
      now: () => NOW,
    });

    await expect(read()).resolves.toBe(issued);
    mirror = issued; // onAuthStateChange mirrors the refreshed token.
    await expect(read()).resolves.toBe(issued);
    await expect(read()).resolves.toBe(issued);
    expect(supabase.auth.getSession).toHaveBeenCalledTimes(1);
  });

  it("never learns an offset from an old token returned unrefreshed", async () => {
    // Right clock. The mirror lags, and Auth hands back a newer but not new
    // token with plenty of life left: no skew, so nothing to learn, and the
    // next lapsed token still refreshes.
    let mirror = tokenExpiringAt(NOW - 1_000, NOW - 60 * 60_000);
    const newer = tokenExpiringAt(NOW + 10 * 60_000, NOW - 50 * 60_000);
    const supabase = fakeSupabase(async () => ({
      data: { session: { access_token: newer } },
      error: null,
    }));
    const read = createFreshAuthTokenReader({
      readToken: async () => mirror,
      getSupabase: () => supabase as never,
      now: () => NOW,
    });

    await expect(read()).resolves.toBe(newer);
    mirror = tokenExpiringAt(NOW - 1_000, NOW - 60 * 60_000);
    await read();
    expect(supabase.auth.getSession).toHaveBeenCalledTimes(2);
  });

  it("never learns an offset from the same token handed back after a failed refresh", async () => {
    // Right clock. The token is inside the margin, the proactive refresh
    // fails, and supabase-js returns the stored session unrefreshed with no
    // error. Learning from that token's hour-old iat used to shift the clock
    // back an hour, so a token that later expired went out as if it were
    // fresh and every request came back 401 (FRAPP-API-E, 2026-11-12).
    const ISSUED = NOW - 60 * 60_000 + 30_000;
    const nearlyExpired = tokenExpiringAt(NOW + 30_000, ISSUED);
    const supabase = fakeSupabase(async () => ({
      data: { session: { access_token: nearlyExpired } },
      error: null,
    }));
    let clock = NOW;
    const read = createFreshAuthTokenReader({
      readToken: async () => nearlyExpired,
      getSupabase: () => supabase as never,
      now: () => clock,
    });

    await expect(read()).resolves.toBe(nearlyExpired);
    // Half an hour later, back from the background: the token is long
    // expired, so the reader must still ask Auth for a fresh one.
    clock = NOW + 30 * 60_000;
    await read();
    expect(supabase.auth.getSession).toHaveBeenCalledTimes(2);
  });

  it("passes through no token, an opaque token, and a missing client", async () => {
    const supabase = fakeSupabase(async () => ({
      data: { session: { access_token: "fresh" } },
      error: null,
    }));
    await expect(reader(null, supabase)()).resolves.toBeNull();
    await expect(reader("opaque", supabase)()).resolves.toBe("opaque");
    expect(supabase.auth.getSession).not.toHaveBeenCalled();

    const stale = tokenExpiringAt(NOW - 1_000);
    await expect(reader(stale, null)()).resolves.toBe(stale);
  });
});
