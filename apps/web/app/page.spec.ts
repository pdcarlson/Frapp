import { beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => ({ auth: { getSession } })),
}));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Redirect(to);
  },
}));

class Redirect extends Error {
  constructor(readonly to: string) {
    super(to);
  }
}

import Home from "./page";

async function land(params: Record<string, string | string[]> = {}) {
  try {
    await Home({ searchParams: Promise.resolve(params) });
  } catch (error) {
    if (error instanceof Redirect) return error.to;
    throw error;
  }
  throw new Error("expected a redirect");
}

describe("/ (the signed-out gate)", () => {
  beforeEach(() => {
    getSession.mockReset();
    getSession.mockResolvedValue({ data: { session: null } });
  });

  it("sends a visitor without a session to the sign-in form", async () => {
    expect(await land()).toBe("/sign-in");
  });

  it("sends a signed-in member to chat", async () => {
    getSession.mockResolvedValue({ data: { session: { user: { id: "u" } } } });
    expect(await land()).toBe("/chat");
  });

  it("keeps the query on the hop to the form, so redirectTo survives", async () => {
    expect(await land({ redirectTo: "/join?token=inv-1" })).toBe(
      "/sign-in?redirectTo=%2Fjoin%3Ftoken%3Dinv-1",
    );
  });

  it.each([
    [{ code: "abc123" }, "code=abc123"],
    [{ token_hash: "h", type: "magiclink" }, "token_hash=h&type=magiclink"],
    [{ error: "access_denied", error_code: "otp_expired" }, "error=access_denied&error_code=otp_expired"],
  ])(
    "hands a sign-in link GoTrue sent to the Site URL to the callback (%o)",
    async (params, query) => {
      expect(await land(params)).toBe(`/auth/callback?${query}`);
      expect(getSession).not.toHaveBeenCalled();
    },
  );
});
