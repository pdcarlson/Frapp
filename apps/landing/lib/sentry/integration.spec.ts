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

function itemsFromEnvelope<T>(envelope: unknown, type: string): T[] {
  if (!Array.isArray(envelope) || !Array.isArray(envelope[1])) return [];
  return (envelope[1] as [{ type?: string }, T][])
    .filter(([headers]) => headers?.type === type)
    .map(([, payload]) => payload);
}

describe("Sentry SDK integration", () => {
  let sent: ErrorEvent[] = [];
  let sentTransactions: Record<string, unknown>[] = [];

  beforeAll(() => {
    Sentry.init({
      ...buildLandingSentryOptions(FIXTURE_DSN),
      // Every span sampled, so the transaction test is deterministic.
      tracesSampleRate: 1,
      defaultIntegrations: false,
      integrations: [],
      transport: () => ({
        send: (envelope: unknown) => {
          sent.push(...itemsFromEnvelope<ErrorEvent>(envelope, "event"));
          sentTransactions.push(
            ...itemsFromEnvelope<Record<string, unknown>>(
              envelope,
              "transaction",
            ),
          );
          return Promise.resolve({ statusCode: 200 });
        },
        flush: () => Promise.resolve(true),
      }),
    });
  });

  beforeEach(() => {
    sent = [];
    sentTransactions = [];
  });

  afterAll(async () => {
    await Sentry.close(2000);
  });

  it("ships production options: static traces, both hooks, no replay", () => {
    const browser = buildLandingSentryOptions(FIXTURE_DSN);
    const server = buildLandingServerSentryOptions(FIXTURE_DSN);
    // v11's default, "stream", never calls `beforeSendTransaction` (#2722).
    expect(browser.traceLifecycle).toBe("static");
    expect(server.traceLifecycle).toBe("static");
    expect(server.dataCollection).toEqual(browser.dataCollection);
    expect(browser.replaysSessionSampleRate).toBe(0);
    expect(browser.replaysOnErrorSampleRate).toBe(0);
    expect(typeof browser.beforeSend).toBe("function");
    expect(typeof browser.beforeSendTransaction).toBe("function");
  });

  it("leaves no data-collection category to the SDK default (#2722)", () => {
    // Read back from the live client: what the installed SDK resolved. v11
    // defaults every category to on, so one missing from `dataCollection`,
    // or one a future SDK adds, resolves to `true` and fails `toEqual`.
    // Literals on purpose, so the builder is not read back to itself.
    expect(Sentry.getClient()?.getDataCollectionOptions()).toEqual({
      userInfo: false,
      cookies: false,
      httpHeaders: {
        request: { allow: ["content-type", "x-request-id"] },
        response: false,
      },
      httpBodies: [],
      urlQueryParams: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
      frameContextLines: 7,
    });
  });

  it("ships a transaction through beforeSendTransaction", async () => {
    Sentry.startSpan(
      {
        name: `/join?email=${MEMBER_EMAIL}`,
        op: "pageload",
        forceTransaction: true,
      },
      () => undefined,
    );
    await Sentry.flush(2000);

    expect(sentTransactions).toHaveLength(1);
    expect(JSON.stringify(sentTransactions[0])).not.toContain(MEMBER_EMAIL);
    expect(sentTransactions[0]?.transaction).toBe("/join");
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
