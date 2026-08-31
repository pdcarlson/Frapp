import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The mobile Sentry configuration the app actually ships (#1299).
 *
 * Asserted against `buildMobileSentryOptions` rather than against literals, for
 * the reason the API's `sentry-integration.spec.ts` and the web twin both give:
 * a test that asserts against its own copy of the config proves nothing about
 * production, because the copy drifts silently.
 *
 * `options.ts` imports `@sentry/react-native` **for types only**, so this spec
 * loads the real shipped module without pulling in a native binding that does
 * not exist under vitest (where `react-native` is aliased to
 * `react-native-web`).
 *
 * The env gates are read through a fresh module import per test — the reads are
 * inlined by Expo at build time but are live lookups here.
 */

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
  it("reports no DSN when the variable is unset", async () => {
    vi.stubEnv("EXPO_PUBLIC_SENTRY_DSN", undefined as unknown as string);
    const { mobileSentryDsn } = await loadOptions();
    expect(mobileSentryDsn()).toBeUndefined();
  });

  it("treats an empty string as unset rather than passing a malformed DSN", async () => {
    vi.stubEnv("EXPO_PUBLIC_SENTRY_DSN", "");
    const { mobileSentryDsn } = await loadOptions();
    expect(mobileSentryDsn()).toBeUndefined();
  });

  it("returns the DSN when configured", async () => {
    vi.stubEnv("EXPO_PUBLIC_SENTRY_DSN", DSN);
    const { mobileSentryDsn } = await loadOptions();
    expect(mobileSentryDsn()).toBe(DSN);
  });
});

describe("environment tagging", () => {
  it("defaults to development rather than letting Sentry assume production", async () => {
    // Sentry files an event with no `environment` under `production`. A
    // simulator or Expo Go crash landing beside a real member's would make the
    // frapp-mobile alert thresholds meaningless.
    vi.stubEnv(
      "EXPO_PUBLIC_SENTRY_ENVIRONMENT",
      undefined as unknown as string,
    );
    const { buildMobileSentryOptions } = await loadOptions();
    expect(buildMobileSentryOptions(DSN).environment).toBe("development");
  });

  it("uses the per-profile value from eas.json when set", async () => {
    vi.stubEnv("EXPO_PUBLIC_SENTRY_ENVIRONMENT", "staging");
    const { buildMobileSentryOptions } = await loadOptions();
    expect(buildMobileSentryOptions(DSN).environment).toBe("staging");
  });

  it("treats an empty value as unset", async () => {
    vi.stubEnv("EXPO_PUBLIC_SENTRY_ENVIRONMENT", "");
    const { buildMobileSentryOptions } = await loadOptions();
    expect(buildMobileSentryOptions(DSN).environment).toBe("development");
  });
});

describe("shipped options", () => {
  it("never enables sendDefaultPii", async () => {
    const { buildMobileSentryOptions } = await loadOptions();
    expect(buildMobileSentryOptions(DSN).sendDefaultPii).toBe(false);
  });

  it("carries a finite sample rate, so tracing cannot be enabled by NaN", async () => {
    // #904: a malformed rate parses to NaN, which the SDK treats as enabled.
    // Mobile hardcodes the value, so this asserts the property that choice buys.
    const { buildMobileSentryOptions } = await loadOptions();
    const rate = buildMobileSentryOptions(DSN).tracesSampleRate;
    expect(Number.isFinite(rate)).toBe(true);
    expect(rate).toBe(0.1);
  });

  it("wires BOTH scrubbing hooks", async () => {
    // Setting only one leaves the other event class shipping unscrubbed — the
    // gap #896 closed on the API.
    const { buildMobileSentryOptions } = await loadOptions();
    const options = buildMobileSentryOptions(DSN);
    expect(typeof options.beforeSend).toBe("function");
    expect(typeof options.beforeSendTransaction).toBe("function");
  });

  it("scrubs a member email out of an error event", async () => {
    const { buildMobileSentryOptions } = await loadOptions();
    const beforeSend = buildMobileSentryOptions(DSN).beforeSend!;

    const scrubbed = beforeSend(
      {
        exception: {
          values: [
            { type: "Error", value: `invite failed for ${MEMBER_EMAIL}` },
          ],
        },
      } as never,
      {} as never,
    );

    expect(JSON.stringify(scrubbed)).not.toContain(MEMBER_EMAIL);
  });

  it("redacts identifiers rather than hashing them, because the bundle has no salt", async () => {
    const { buildMobileSentryOptions } = await loadOptions();
    const beforeSend = buildMobileSentryOptions(DSN).beforeSend!;

    const scrubbed = beforeSend(
      { message: `chapter ${USER_UUID} failed` } as never,
      {} as never,
    );

    const json = JSON.stringify(scrubbed);
    expect(json).not.toContain(USER_UUID);
    expect(json).toContain("[redacted:id]");
    // `[id:<hmac>]` would mean a salt reached the bundle.
    expect(json).not.toContain("[id:");
  });

  it("keeps spans on a transaction rather than emptying the trace", async () => {
    const { buildMobileSentryOptions } = await loadOptions();
    const beforeSendTransaction =
      buildMobileSentryOptions(DSN).beforeSendTransaction!;

    const scrubbed = beforeSendTransaction(
      {
        transaction: "/chat",
        spans: [
          {
            span_id: "abc",
            description: `GET /v1/members?email=${MEMBER_EMAIL}`,
            data: { "http.request.method": "GET" },
          },
        ],
      } as never,
      {} as never,
    ) as { spans?: unknown[] } | null;

    expect(scrubbed?.spans).toHaveLength(1);
    expect(JSON.stringify(scrubbed)).not.toContain(MEMBER_EMAIL);
  });
});

describe("no salt reaches the bundle", () => {
  it("reads no salt-shaped environment variable anywhere under lib/sentry", async () => {
    // The salt is API-only (`ENV_REFERENCE.md`). A mobile module reading it
    // would mean it had to be present at build time, and Expo would inline it
    // into the shipped bundle — the one outcome this design forbids. Guarded at
    // the source because it is the cheap half; the bundle grep (AC #4) is the
    // other.
    const { readFileSync, readdirSync } = await import("node:fs");
    const { join, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");

    const dir = dirname(fileURLToPath(import.meta.url));
    // Excluding specs: this file names the forbidden strings in its own
    // assertions, so including it would make the test fail on itself.
    const sources = readdirSync(dir).filter(
      (f) => f.endsWith(".ts") && !f.endsWith(".spec.ts"),
    );
    expect(sources.length).toBeGreaterThan(0);

    for (const file of sources) {
      const source = readFileSync(join(dir, file), "utf8");
      expect(source).not.toContain("process.env.ANALYTICS_HMAC_SALT");
      expect(source).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    }
  });
});
