import { afterEach, describe, expect, it, vi } from "vitest";

const resetPostHog = vi.hoisted(() => vi.fn());
const setUser = vi.hoisted(() => vi.fn());
const signOut = vi.hoisted(() => vi.fn(async () => ({ error: null })));

vi.mock("@repo/observability/identified-posthog", () => ({
  resetPostHog,
}));

vi.mock("@sentry/nextjs", () => ({
  setUser,
}));

vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: () => ({
    auth: { signOut, getUser: vi.fn() },
  }),
}));

afterEach(() => {
  resetPostHog.mockReset();
  setUser.mockReset();
  signOut.mockClear();
});

describe("resetObservabilityOnLogout", () => {
  it("clears PostHog and Sentry user", async () => {
    const { resetObservabilityOnLogout } = await import("./reset");
    resetObservabilityOnLogout();
    expect(resetPostHog).toHaveBeenCalledTimes(1);
    expect(setUser).toHaveBeenCalledWith(null);
  });
});

describe("signOutCurrentSession", () => {
  it("resets observability after a successful sign-out", async () => {
    const { signOutCurrentSession } = await import("@/lib/auth/session");
    await signOutCurrentSession();
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(resetPostHog).toHaveBeenCalledTimes(1);
    expect(setUser).toHaveBeenCalledWith(null);
  });
});
