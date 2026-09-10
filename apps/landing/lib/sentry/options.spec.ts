import { afterEach, describe, expect, it, vi } from "vitest";

const DSN = "https://examplepublickey@o0.ingest.sentry.io/0";
const MEMBER_EMAIL = "treasurer@chapter.example.edu";
const USER_UUID = "3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function loadOptions() {
  return import("./options");
}

describe("DSN gating", () => {
  it("reports no DSN when the landing variable is unset", async () => {
    vi.stubEnv("NEXT_PUBLIC_LANDING_SENTRY_DSN", "");
    const { landingSentryDsn } = await loadOptions();
    expect(landingSentryDsn()).toBeUndefined();
  });

  it("treats an empty string as unset rather than passing a malformed DSN", async () => {
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

describe("shipped options", () => {
  it("never enables sendDefaultPii, on either runtime", async () => {
    const { buildLandingSentryOptions, buildLandingServerSentryOptions } =
      await loadOptions();
    expect(buildLandingSentryOptions(DSN).sendDefaultPii).toBe(false);
    expect(buildLandingServerSentryOptions(DSN).sendDefaultPii).toBe(false);
  });

  it("falls back to 0.1 for malformed traces sample rates on both runtimes", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      vi.stubEnv("NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE", "0,1");
      const { buildLandingSentryOptions, buildLandingServerSentryOptions } =
        await loadOptions();

      for (const options of [
        buildLandingSentryOptions(DSN),
        buildLandingServerSentryOptions(DSN),
      ]) {
        expect(Number.isFinite(options.tracesSampleRate)).toBe(true);
        expect(options.tracesSampleRate).toBe(0.1);
      }
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("does not send Sentry Replay, a lowered error sample rate, or API trace targets", async () => {
    const { buildLandingSentryOptions, buildLandingServerSentryOptions } =
      await loadOptions();
    const browser = buildLandingSentryOptions(DSN);
    expect(browser.replaysSessionSampleRate).toBe(0);
    expect(browser.replaysOnErrorSampleRate).toBe(0);
    expect(browser.sampleRate).toBeUndefined();
    expect(buildLandingServerSentryOptions(DSN).sampleRate).toBeUndefined();
    expect(browser.tracePropagationTargets).toEqual([]);
  });

  it("sets release from the derived git SHA when present", async () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_RELEASE", "deadbeefcafebabe");
    const { buildLandingSentryOptions, landingSentryRelease } =
      await loadOptions();
    expect(landingSentryRelease()).toBe("deadbeefcafebabe");
    expect(buildLandingSentryOptions(DSN).release).toBe("deadbeefcafebabe");
  });

  it("wires BOTH scrubbing hooks on both runtimes", async () => {
    const { buildLandingSentryOptions, buildLandingServerSentryOptions } =
      await loadOptions();

    for (const options of [
      buildLandingSentryOptions(DSN),
      buildLandingServerSentryOptions(DSN),
    ]) {
      expect(typeof options.beforeSend).toBe("function");
      expect(typeof options.beforeSendTransaction).toBe("function");
    }
  });

  it("scrubs a member email out of an error event", async () => {
    const { buildLandingSentryOptions } = await loadOptions();
    const beforeSend = buildLandingSentryOptions(DSN).beforeSend!;

    const scrubbed = beforeSend(
      {
        exception: {
          values: [{ type: "Error", value: `invite failed for ${MEMBER_EMAIL}` }],
        },
      } as never,
      {} as never,
    );

    expect(JSON.stringify(scrubbed)).not.toContain(MEMBER_EMAIL);
  });

  it("redacts identifiers rather than hashing them, because landing has no salt", async () => {
    const { buildLandingSentryOptions } = await loadOptions();
    const beforeSend = buildLandingSentryOptions(DSN).beforeSend!;

    const scrubbed = beforeSend(
      { message: `chapter ${USER_UUID} failed` } as never,
      {} as never,
    );

    const json = JSON.stringify(scrubbed);
    expect(json).not.toContain(USER_UUID);
    expect(json).toContain("[redacted:id]");
    expect(json).not.toContain("[id:");
  });

  it("strips query strings from request URLs", async () => {
    const { buildLandingSentryOptions } = await loadOptions();
    const beforeSend = buildLandingSentryOptions(DSN).beforeSend!;
    const token = "invite-token-secret";

    const scrubbed = beforeSend(
      {
        request: {
          url: `https://frapp.live/join?token=${token}&email=${MEMBER_EMAIL}`,
        },
      } as never,
      {} as never,
    );

    const json = JSON.stringify(scrubbed);
    expect(json).not.toContain(token);
    expect(json).not.toContain(MEMBER_EMAIL);
    expect(json).not.toContain("?");
  });
});

describe("no salt reaches the bundle", () => {
  it("reads no salt-shaped environment variable anywhere under lib/sentry", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const { join } = await import("node:path");

    const dir = join(process.cwd(), "lib", "sentry");
    const sources = readdirSync(dir).filter(
      (f) =>
        (f.endsWith(".ts") || f.endsWith(".js")) &&
        !f.endsWith(".spec.ts") &&
        !f.endsWith(".spec.tsx"),
    );
    expect(sources.length).toBeGreaterThan(0);

    for (const file of sources) {
      const source = readFileSync(join(dir, file), "utf8");
      expect(source).not.toContain("process.env.ANALYTICS_HMAC_SALT");
      expect(source).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
      expect(source).not.toContain("process.env.NEXT_PUBLIC_SENTRY_DSN");
    }
  });
});
