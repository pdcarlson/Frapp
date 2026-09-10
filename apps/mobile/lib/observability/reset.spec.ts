import { afterEach, describe, expect, it, vi } from "vitest";

const resetPostHog = vi.hoisted(() => vi.fn());
const setUser = vi.hoisted(() => vi.fn());

vi.mock("@/lib/posthog/client", () => ({
  resetPostHog,
}));

vi.mock("@sentry/react-native", () => ({
  setUser,
}));

afterEach(() => {
  resetPostHog.mockReset();
  setUser.mockReset();
});

describe("resetObservabilityOnLogout", () => {
  it("clears PostHog and Sentry user", async () => {
    const { resetObservabilityOnLogout } = await import("./reset");
    resetObservabilityOnLogout();
    expect(resetPostHog).toHaveBeenCalledTimes(1);
    expect(setUser).toHaveBeenCalledWith(null);
  });
});
