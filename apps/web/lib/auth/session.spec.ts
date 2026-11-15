import { beforeEach, describe, expect, it, vi } from "vitest";

const signOut = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: () => ({ auth: { signOut } }),
}));
vi.mock("@/lib/observability/reset", () => ({
  resetObservabilityOnLogout: vi.fn(),
}));

describe("signingOutHere (#4440)", () => {
  beforeEach(() => {
    vi.resetModules();
    signOut.mockReset().mockResolvedValue({ error: null });
  });

  it("is false until this tab signs out, then true for the window", async () => {
    const { signOutCurrentSession, signingOutHere } = await import("./session");
    expect(signingOutHere()).toBe(false);

    // Latched before the server-side revoke, while the call is in flight.
    let seenDuring: boolean | null = null;
    signOut.mockImplementation(async () => {
      seenDuring = signingOutHere();
      return { error: null };
    });
    const start = Date.now();
    await signOutCurrentSession();
    expect(seenDuring).toBe(true);
    expect(signingOutHere(start + 29_000)).toBe(true);
    expect(signingOutHere(start + 31_000)).toBe(false);
  });
});
