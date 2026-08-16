import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The web Sentry configuration the app actually ships (#865).
 *
 * Asserted against `buildWebSentryOptions` / `buildServerSentryOptions` rather
 * than against literals, for the reason the API's `sentry-integration.spec.ts`
 * gives: a test that asserts against its own copy of the config proves nothing
 * about production, because the copy drifts silently.
 *
 * The DSN gate is read through a fresh module import per test — `webSentryDsn`
 * reads `process.env.NEXT_PUBLIC_SENTRY_DSN`, which Next inlines at build time
 * but which is a live lookup under vitest.
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
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "");
    const { webSentryDsn } = await loadOptions();
    expect(webSentryDsn()).toBeUndefined();
  });

  it("treats an empty string as unset rather than passing a malformed DSN", async () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "");
    const { webSentryDsn } = await loadOptions();
    expect(webSentryDsn()).toBeUndefined();
  });

  it("returns the DSN when configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", DSN);
    const { webSentryDsn } = await loadOptions();
    expect(webSentryDsn()).toBe(DSN);
  });
});

describe("shipped options", () => {
  it("never enables sendDefaultPii, on either runtime", async () => {
    const { buildWebSentryOptions, buildServerSentryOptions } =
      await loadOptions();
    expect(buildWebSentryOptions(DSN).sendDefaultPii).toBe(false);
    expect(buildServerSentryOptions(DSN).sendDefaultPii).toBe(false);
  });

  it("wires BOTH scrubbing hooks on both runtimes", async () => {
    const { buildWebSentryOptions, buildServerSentryOptions } =
      await loadOptions();

    // Setting only one leaves the other event class shipping unscrubbed — the
    // gap #896 closed on the API. Both builders must set both.
    for (const options of [
      buildWebSentryOptions(DSN),
      buildServerSentryOptions(DSN),
    ]) {
      expect(typeof options.beforeSend).toBe("function");
      expect(typeof options.beforeSendTransaction).toBe("function");
    }
  });

  it("scrubs a member email out of an error event", async () => {
    const { buildWebSentryOptions } = await loadOptions();
    const beforeSend = buildWebSentryOptions(DSN).beforeSend!;

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

  it("redacts identifiers rather than hashing them, because the browser has no salt", async () => {
    const { buildWebSentryOptions } = await loadOptions();
    const beforeSend = buildWebSentryOptions(DSN).beforeSend!;

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
    const { buildWebSentryOptions } = await loadOptions();
    const beforeSendTransaction =
      buildWebSentryOptions(DSN).beforeSendTransaction!;

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
    // The salt is API-only (`ENV_REFERENCE.md`). A web module reading it would
    // mean it had to be present at build time, and Next would inline it into the
    // client bundle — the one outcome this design forbids. Guarded at the source
    // because it is the cheap half; the build-output grep (AC #3) is the other.
    const { readFileSync, readdirSync } = await import("node:fs");
    const { join } = await import("node:path");

    const dir = join(process.cwd(), "lib", "sentry");
    // Excluding specs: this file names the forbidden strings in its own
    // assertions, so including it would make the test fail on itself.
    const sources = readdirSync(dir).filter(
      (f) => f.endsWith(".ts") && !f.endsWith(".test.ts"),
    );
    expect(sources.length).toBeGreaterThan(0);

    for (const file of sources) {
      const source = readFileSync(join(dir, file), "utf8");
      expect(source).not.toContain("process.env.ANALYTICS_HMAC_SALT");
      expect(source).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    }
  });
});
