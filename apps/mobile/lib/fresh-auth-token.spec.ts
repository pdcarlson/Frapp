import { describe, expect, it, vi } from "vitest";
import {
  TOKEN_EXPIRY_MARGIN_MS,
  accessTokenExpiresAt,
  createFreshAuthTokenReader,
} from "./fresh-auth-token";

const NOW = 1_800_000_000_000;

/** An unsigned JWT-shaped token whose payload carries only `exp`. */
function tokenExpiringAt(ms: number): string {
  const payload = btoa(JSON.stringify({ exp: Math.floor(ms / 1000) }))
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

describe("accessTokenExpiresAt", () => {
  it("reads exp from a base64url payload", () => {
    expect(accessTokenExpiresAt(tokenExpiringAt(NOW))).toBe(NOW);
  });

  it("is null for anything that isn't a JWT with a numeric exp", () => {
    expect(accessTokenExpiresAt("opaque")).toBeNull();
    expect(accessTokenExpiresAt("a.!!!.c")).toBeNull();
    expect(accessTokenExpiresAt(`e30.${btoa("{}")}.sig`)).toBeNull();
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
