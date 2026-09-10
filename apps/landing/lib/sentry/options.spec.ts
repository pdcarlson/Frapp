import { afterEach, describe, expect, it, vi } from "vitest";

const DSN = "https://examplepublickey@o0.ingest.sentry.io/0";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function loadOptions() {
  return import("./options");
}

describe("landing DSN gating", () => {
  it("reports no DSN when the landing variable is unset", async () => {
    vi.stubEnv("NEXT_PUBLIC_LANDING_SENTRY_DSN", "");
    const { landingSentryDsn } = await loadOptions();
    expect(landingSentryDsn()).toBeUndefined();
  });

  it("returns the landing DSN when configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_LANDING_SENTRY_DSN", DSN);
    const { landingSentryDsn } = await loadOptions();
    expect(landingSentryDsn()).toBe(DSN);
  });

  it("does not read the web DSN", async () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", DSN);
    vi.stubEnv("NEXT_PUBLIC_LANDING_SENTRY_DSN", "");
    const { landingSentryDsn } = await loadOptions();
    expect(landingSentryDsn()).toBeUndefined();
  });
});

describe("landing-only runtime", () => {
  it("does not propagate traces to the API", async () => {
    const { buildLandingSentryOptions } = await loadOptions();
    expect(buildLandingSentryOptions(DSN).tracePropagationTargets).toEqual([]);
  });
});
