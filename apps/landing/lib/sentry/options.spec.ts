import { afterEach, describe, expect, it, vi } from "vitest";

const LANDING_DSN = "https://examplepublickey@o0.ingest.sentry.io/0";

describe("landing DSN gating", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("reports no DSN when NEXT_PUBLIC_LANDING_SENTRY_DSN is unset", async () => {
    vi.stubEnv("NEXT_PUBLIC_LANDING_SENTRY_DSN", "");
    expect((await import("./options")).landingSentryDsn()).toBeUndefined();
  });

  it("returns the landing DSN when configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_LANDING_SENTRY_DSN", LANDING_DSN);
    expect((await import("./options")).landingSentryDsn()).toBe(LANDING_DSN);
  });

  it("does not treat the web DSN as a landing credential", async () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", LANDING_DSN);
    vi.stubEnv("NEXT_PUBLIC_LANDING_SENTRY_DSN", "");
    expect((await import("./options")).landingSentryDsn()).toBeUndefined();
  });
});

describe("landing-only runtime", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("does not propagate traces to the API", async () => {
    const { buildLandingSentryOptions } = await import("./options");
    expect(buildLandingSentryOptions(LANDING_DSN).tracePropagationTargets).toEqual(
      [],
    );
  });
});
