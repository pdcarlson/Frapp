import { afterEach, describe, expect, it, vi } from "vitest";

const resetPostHog = vi.hoisted(() => vi.fn());
const setUser = vi.hoisted(() => vi.fn());

vi.mock("@repo/observability/identified-posthog", () => ({
  resetPostHog,
}));

vi.mock("@sentry/react-native", () => ({
  setUser,
}));

afterEach(() => {
  resetPostHog.mockClear();
  setUser.mockClear();
});

describe("mobile logout observability", () => {
  it("resets the shared PostHog adapter and drops Sentry user", async () => {
    const { resetObservabilityOnLogout } = await import("./reset");
    resetObservabilityOnLogout();
    expect(resetPostHog).toHaveBeenCalledOnce();
    expect(setUser).toHaveBeenCalledWith(null);
  });
});
