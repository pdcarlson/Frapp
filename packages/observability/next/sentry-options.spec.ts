import { describe, expect, it, vi } from "vitest";
import { POSTHOG_EXCEPTION_AUTOCAPTURE } from "../src/policy";
import {
  buildAnonymousBrowserSentryOptions,
  buildAnonymousServerSentryOptions,
} from "./sentry-options";

const DSN = "https://examplepublickey@o0.ingest.sentry.io/0";
const MEMBER_EMAIL = "treasurer@chapter.example.edu";
const USER_UUID = "3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b";

function runtime(overrides: Record<string, unknown> = {}) {
  return {
    dsn: DSN,
    environment: "preview",
    ...overrides,
  };
}

describe("anonymous Next Sentry options", () => {
  it("never enables sendDefaultPii, on either runtime", () => {
    expect(buildAnonymousBrowserSentryOptions(runtime()).sendDefaultPii).toBe(
      false,
    );
    expect(buildAnonymousServerSentryOptions(runtime()).sendDefaultPii).toBe(
      false,
    );
  });

  it("falls back to 0.1 for malformed traces sample rates on both runtimes", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      for (const options of [
        buildAnonymousBrowserSentryOptions(
          runtime({ tracesSampleRateRaw: "0,1" }),
        ),
        buildAnonymousServerSentryOptions(
          runtime({ tracesSampleRateRaw: "0,1" }),
        ),
      ]) {
        expect(Number.isFinite(options.tracesSampleRate)).toBe(true);
        expect(options.tracesSampleRate).toBe(0.1);
      }
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("does not send Sentry Replay or a lowered error sample rate", () => {
    const browser = buildAnonymousBrowserSentryOptions(runtime());
    expect(browser.replaysSessionSampleRate).toBe(0);
    expect(browser.replaysOnErrorSampleRate).toBe(0);
    expect(browser.sampleRate).toBeUndefined();
    expect(buildAnonymousServerSentryOptions(runtime()).sampleRate).toBe(
      undefined,
    );
    expect(browser.tracePropagationTargets).toEqual([]);
  });

  it("sets release when the caller passes a git SHA", () => {
    const browser = buildAnonymousBrowserSentryOptions(
      runtime({ release: "deadbeefcafebabe" }),
    );
    expect(browser.release).toBe("deadbeefcafebabe");
  });

  it("wires BOTH scrubbing hooks on both runtimes", () => {
    for (const options of [
      buildAnonymousBrowserSentryOptions(runtime()),
      buildAnonymousServerSentryOptions(runtime()),
    ]) {
      expect(typeof options.beforeSend).toBe("function");
      expect(typeof options.beforeSendTransaction).toBe("function");
    }
  });

  it("scrubs a member email out of an error event", () => {
    const beforeSend = buildAnonymousBrowserSentryOptions(runtime()).beforeSend;
    const scrubbed = beforeSend({
      exception: {
        values: [{ type: "Error", value: `invite failed for ${MEMBER_EMAIL}` }],
      },
    });
    expect(JSON.stringify(scrubbed)).not.toContain(MEMBER_EMAIL);
  });

  it("redacts identifiers rather than hashing them", () => {
    const beforeSend = buildAnonymousBrowserSentryOptions(runtime()).beforeSend;
    const scrubbed = beforeSend({
      message: `chapter ${USER_UUID} failed`,
    });
    const json = JSON.stringify(scrubbed);
    expect(json).not.toContain(USER_UUID);
    expect(json).toContain("[redacted:id]");
    expect(json).not.toContain("[id:");
  });

  it("strips query strings from request URLs", () => {
    const beforeSend = buildAnonymousBrowserSentryOptions(runtime()).beforeSend;
    const token = "invite-token-secret";
    const scrubbed = beforeSend({
      request: {
        url: `https://frapp.live/join?token=${token}&email=${MEMBER_EMAIL}`,
      },
    });
    const json = JSON.stringify(scrubbed);
    expect(json).not.toContain(token);
    expect(json).not.toContain(MEMBER_EMAIL);
    expect(json).not.toContain("?");
  });

  it("keeps spans on a transaction rather than emptying the trace", () => {
    const beforeSendTransaction =
      buildAnonymousBrowserSentryOptions(runtime()).beforeSendTransaction;
    const scrubbed = beforeSendTransaction({
      transaction: "/chat",
      spans: [
        {
          span_id: "abc",
          description: `GET /v1/members?email=${MEMBER_EMAIL}`,
          data: { "http.request.method": "GET" },
        },
      ],
    }) as { spans?: unknown[] } | null;
    expect(scrubbed?.spans).toHaveLength(1);
    expect(JSON.stringify(scrubbed)).not.toContain(MEMBER_EMAIL);
  });
});

describe("exception autocapture policy is still off", () => {
  it("does not belong on Sentry options (PostHog owns the flag)", () => {
    expect(POSTHOG_EXCEPTION_AUTOCAPTURE).toBe(false);
  });
});
