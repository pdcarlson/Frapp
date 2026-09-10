import * as Sentry from "@sentry/nextjs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  buildLandingSentryOptions,
  buildLandingServerSentryOptions,
} from "./options";

/**
 * End-to-end wiring test for the real Sentry SDK on landing.
 *
 * Options come from {@link buildLandingSentryOptions}. Assertions read what
 * reached the fake transport — the envelope that would have shipped.
 */

const FIXTURE_DSN = "https://fixturekey@o0.ingest.example.invalid/1";
const MEMBER_EMAIL = "treasurer@chapter.example.edu";
const USER_UUID = "3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b";
const INVITE_TOKEN = "invite-token-secret";

type ErrorEvent = {
  exception?: { values?: { type?: string; value?: string }[] };
  message?: string;
  request?: { url?: string; query_string?: string; data?: unknown };
  user?: { email?: string; ip_address?: string; id?: string };
  extra?: unknown;
};

function eventsFromEnvelope(envelope: unknown): ErrorEvent[] {
  if (!Array.isArray(envelope) || !Array.isArray(envelope[1])) return [];
  return (envelope[1] as [{ type?: string }, ErrorEvent][])
    .filter(([headers]) => headers?.type === "event")
    .map(([, payload]) => payload);
}

describe("Sentry SDK integration", () => {
  let sent: ErrorEvent[] = [];

  beforeAll(() => {
    Sentry.init({
      ...buildLandingSentryOptions(FIXTURE_DSN),
      defaultIntegrations: false,
      integrations: [],
      transport: () => ({
        send: (envelope: unknown) => {
          for (const event of eventsFromEnvelope(envelope)) sent.push(event);
          return Promise.resolve({ statusCode: 200 });
        },
        flush: () => Promise.resolve(true),
      }),
    });
  });

  beforeEach(() => {
    sent = [];
  });

  afterAll(async () => {
    await Sentry.close(2000);
  });

  it("ships production options: no PII flag, both hooks, no replay", () => {
    const browser = buildLandingSentryOptions(FIXTURE_DSN);
    const server = buildLandingServerSentryOptions(FIXTURE_DSN);
    expect(browser.sendDefaultPii).toBe(false);
    expect(server.sendDefaultPii).toBe(false);
    expect(browser.replaysSessionSampleRate).toBe(0);
    expect(browser.replaysOnErrorSampleRate).toBe(0);
    expect(typeof browser.beforeSend).toBe("function");
    expect(typeof browser.beforeSendTransaction).toBe("function");
  });

  it("does not put email, IP, token, query, or body on the envelope", async () => {
    Sentry.captureEvent({
      message: `invite failed for ${MEMBER_EMAIL} uuid=${USER_UUID}`,
      user: {
        email: MEMBER_EMAIL,
        ip_address: "203.0.113.9",
        id: USER_UUID,
      },
      request: {
        url: `https://frapp.live/join?token=${INVITE_TOKEN}&email=${MEMBER_EMAIL}`,
        query_string: `token=${INVITE_TOKEN}`,
        data: { email: MEMBER_EMAIL, token: INVITE_TOKEN },
      },
    });
    await Sentry.flush(2000);

    expect(sent.length).toBeGreaterThan(0);
    const json = JSON.stringify(sent);
    expect(json).not.toContain(MEMBER_EMAIL);
    expect(json).not.toContain(USER_UUID);
    expect(json).not.toContain(INVITE_TOKEN);
    expect(json).not.toContain("203.0.113.9");
    expect(json).not.toContain("token=");
    expect(json).not.toMatch(/"query_string"/);
    expect(json).not.toMatch(/"data":\{"email"/);

    const message =
      sent[0]?.exception?.values?.[0]?.value ?? sent[0]?.message ?? "";
    expect(message).not.toContain(MEMBER_EMAIL);
    expect(message).not.toContain(USER_UUID);
  });
});
