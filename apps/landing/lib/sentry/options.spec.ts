import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Landing-only Sentry contract: `frapp-landing` DSN, empty trace targets,
 * no web DSN read. Shared scrub/replay policy is asserted in
 * `@repo/observability` and `apps/web` — do not clone those cases here.
 */

const LANDING_DSN = "https://public@o0.ingest.sentry.io/landing";
const WEB_DSN = "https://public@o0.ingest.sentry.io/web";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function loadLandingSentry() {
  return import("./options");
}

describe("landing DSN isolation", () => {
  it("reads only NEXT_PUBLIC_LANDING_SENTRY_DSN", async () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", WEB_DSN);
    vi.stubEnv("NEXT_PUBLIC_LANDING_SENTRY_DSN", "");
    const { landingSentryDsn } = await loadLandingSentry();
    expect(landingSentryDsn()).toBeUndefined();

    vi.stubEnv("NEXT_PUBLIC_LANDING_SENTRY_DSN", LANDING_DSN);
    const again = await loadLandingSentry();
    expect(again.landingSentryDsn()).toBe(LANDING_DSN);
  });
});

describe("landing shipped options", () => {
  it("propagates no traces and keeps replay plus PII off", async () => {
    const {
      buildLandingSentryOptions,
      buildLandingServerSentryOptions,
    } = await loadLandingSentry();
    const browser = buildLandingSentryOptions(LANDING_DSN);
    const server = buildLandingServerSentryOptions(LANDING_DSN);
    expect(browser.sendDefaultPii).toBe(false);
    expect(server.sendDefaultPii).toBe(false);
    expect(browser.tracePropagationTargets).toEqual([]);
    expect(browser.replaysSessionSampleRate).toBe(0);
    expect(browser.replaysOnErrorSampleRate).toBe(0);
    expect(browser.sampleRate).toBeUndefined();
    expect(typeof browser.beforeSend).toBe("function");
    expect(typeof browser.beforeSendTransaction).toBe("function");
    expect(typeof server.beforeSend).toBe("function");
    expect(typeof server.beforeSendTransaction).toBe("function");
  });

  it("applies a derived release when Vercel inlined one", async () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_RELEASE", "cafef00d");
    const { buildLandingSentryOptions, landingSentryRelease } =
      await loadLandingSentry();
    expect(landingSentryRelease()).toBe("cafef00d");
    expect(buildLandingSentryOptions(LANDING_DSN).release).toBe("cafef00d");
  });

  it("treats a comma-decimal traces rate as the 0.1 fallback", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubEnv("NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE", "0,1");
    const { buildLandingSentryOptions } = await loadLandingSentry();
    expect(buildLandingSentryOptions(LANDING_DSN).tracesSampleRate).toBe(0.1);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
