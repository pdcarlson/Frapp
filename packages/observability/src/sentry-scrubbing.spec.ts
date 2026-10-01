import { describe, expect, it } from "vitest";
import {
  createSentryScrubber,
  NO_PSEUDONYMS,
  reduceSelector,
  reduceTouchBreadcrumb,
  type ScrubbableEvent,
  type SentryPseudonymizer,
} from "./sentry-scrubbing";

/**
 * Deterministic 64-hex stand-in. HMAC stays API-local (Node crypto + salt);
 * this package must not import `@repo/validation` just to hash a fixture.
 */
function hex64(seed: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < 32; i += 1) {
    bytes.push((seed.charCodeAt(i % seed.length) + i * 17) & 0xff);
  }
  return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The shared scrubber, exercised on the **browser** path (#865).
 *
 * `apps/api`'s own suites already pin the server path and still pass unmodified
 * against this module — that is the signal the extraction was clean, and it is
 * deliberately not duplicated here. What this file covers is the half that did
 * not exist before: a client that holds **no salt**, carrying the PII a browser
 * bundle has and a server process does not — chat message bodies, member
 * emails, chapter names, document titles.
 *
 * Assertions are phrased as "the raw value appears nowhere in the serialized
 * event" rather than "field X was deleted", for the same reason the API suite
 * phrases them that way: a scrubber that clears the field it knows about while
 * the same value survives in a breadcrumb has not done its job, and only the
 * whole-payload assertion catches that.
 */

const USER_UUID = "3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b";
const MEMBER_EMAIL = "treasurer@chapter.example.edu";
const CHAT_BODY = "Reminder: dues are late, ping treasurer@chapter.example.edu";

/** The web binding: no salt, so nothing can be hashed. */
const browser = createSentryScrubber(NO_PSEUDONYMS);

/** A server-shaped binding, to pin the with-salt branch of the same code. */
const saltedPseudonyms: SentryPseudonymizer = {
  pseudonymizeUserId: (id) =>
    typeof id === "string" && id ? hex64(id) : undefined,
  pseudonymizeIp: (ip) =>
    typeof ip === "string" && ip ? hex64(ip) : undefined,
};
const salted = createSentryScrubber(saltedPseudonyms);

function serialize(event: ScrubbableEvent | null): string {
  return JSON.stringify(event);
}

describe("browser path — no salt available", () => {
  it("drops a member email from an exception message", () => {
    const scrubbed = browser.scrubSentryEvent({
      exception: {
        values: [{ type: "Error", value: `Failed to invite ${MEMBER_EMAIL}` }],
      },
    });

    const json = serialize(scrubbed);
    expect(json).not.toContain(MEMBER_EMAIL);
    expect(json).toContain("[redacted:email]");
  });

  it("drops a chat message body's email while keeping the surrounding text", () => {
    const scrubbed = browser.scrubSentryEvent({
      message: `Render failed for message: ${CHAT_BODY}`,
    });

    const json = serialize(scrubbed);
    expect(json).not.toContain("treasurer@chapter.example.edu");
    expect(json).toContain("Reminder: dues are late");
  });

  it("redacts identifiers rather than hashing them, because there is no salt", () => {
    const scrubbed = browser.scrubSentryEvent({
      message: `Chapter ${USER_UUID} failed to load`,
    });

    const json = serialize(scrubbed);
    expect(json).not.toContain(USER_UUID);
    expect(json).toContain("[redacted:id]");
    // The `[id:<hmac>]` form is the *server's* output. Seeing it here would mean
    // a salt reached the browser, which is the one outcome this design forbids.
    expect(json).not.toContain("[id:");
  });

  it("never emits a hashed value for an IP either", () => {
    const scrubbed = browser.scrubSentryEvent({
      message: "upstream 203.0.113.42 refused the connection",
    });

    const json = serialize(scrubbed);
    expect(json).not.toContain("203.0.113.42");
    expect(json).toContain("[redacted:ip]");
    expect(json).not.toContain("[ip:");
  });

  it("keeps a server-derived user pseudonym but drops a raw id", () => {
    const pseudonym = hex64("server-derived");

    // This is what the web app attaches via GET /v1/analytics/identity: the
    // server hashed it, so the browser never held the salt.
    const withPseudonym = browser.scrubSentryEvent({ user: { id: pseudonym } });
    expect(serialize(withPseudonym)).toContain(pseudonym);

    // Anything that is not already a pseudonym is dropped, not trusted.
    const withRaw = browser.scrubSentryEvent({
      user: { id: USER_UUID, email: MEMBER_EMAIL, ip_address: "203.0.113.42" },
    });
    const json = serialize(withRaw);
    expect(json).not.toContain(USER_UUID);
    expect(json).not.toContain(MEMBER_EMAIL);
    expect(json).not.toContain("203.0.113.42");
  });

  it("strips query strings from browser navigation URLs", () => {
    const scrubbed = browser.scrubSentryEvent({
      transaction: "/chat/channel?token=abc123&email=me@example.com",
    });

    const json = serialize(scrubbed);
    expect(json).not.toContain("token=abc123");
    expect(json).not.toContain("me@example.com");
    expect(json).toContain("/chat/channel");
  });

  it("drops breadcrumb data bags, which on the client hold fetch payloads", () => {
    const scrubbed = browser.scrubSentryEvent({
      breadcrumbs: [
        {
          category: "fetch",
          message: "GET /v1/chapters",
          data: { body: CHAT_BODY, url: `/v1/users?email=${MEMBER_EMAIL}` },
        },
      ],
    });

    const json = serialize(scrubbed);
    expect(json).not.toContain(MEMBER_EMAIL);
    expect(json).not.toContain("dues are late");
    expect(json).toContain("GET /v1/chapters");
  });

  it("scrubs transaction events on the browser path too", () => {
    const scrubbed = browser.scrubSentryTransaction({
      transaction: "/chat",
      spans: [
        {
          span_id: "abc",
          description: `GET /v1/members?email=${MEMBER_EMAIL}`,
          data: {
            "http.request.method": "GET",
            "http.url": `https://app.example/v1/members?email=${MEMBER_EMAIL}`,
          },
        },
      ],
    });

    const json = serialize(scrubbed);
    expect(json).not.toContain(MEMBER_EMAIL);
    // The span survives with its allowlisted attribute — an emptied span tree is
    // the #896 failure mode this scrubber exists to avoid.
    expect(json).toContain("http.request.method");
    expect(json).toContain("GET");
  });

  it("drops db.statement, url.query, and http.url from span data by omission", () => {
    const scrubbed = browser.scrubSentryTransaction({
      transaction: "/v1/health",
      spans: [
        {
          span_id: "s1",
          data: {
            "http.request.method": "GET",
            "http.response.status_code": 200,
            "db.system": "postgresql",
            "db.statement": `SELECT * FROM users WHERE email = '${MEMBER_EMAIL}'`,
            "url.query": `email=${MEMBER_EMAIL}`,
            "http.url": `https://api.example/v1/users?email=${MEMBER_EMAIL}`,
            "sentry.source": "route",
          },
        },
      ],
      contexts: {
        trace: {
          data: {
            "http.request.method": "GET",
            "http.url": `https://api.example/v1/users?email=${MEMBER_EMAIL}`,
            "url.query": `email=${MEMBER_EMAIL}`,
            "sentry.source": "route",
          },
        },
      },
    });

    const json = serialize(scrubbed);
    expect(json).not.toContain(MEMBER_EMAIL);
    expect(json).not.toContain("SELECT * FROM users");

    const spanData = (
      scrubbed as { spans?: { data?: Record<string, unknown> }[] }
    ).spans?.[0]?.data;
    expect(spanData).toEqual({
      "http.request.method": "GET",
      "http.response.status_code": 200,
      "db.system": "postgresql",
      "sentry.source": "route",
    });

    const traceData = (
      scrubbed as {
        contexts?: { trace?: { data?: Record<string, unknown> } };
      }
    ).contexts?.trace?.data;
    expect(traceData).toEqual({
      "http.request.method": "GET",
      "sentry.source": "route",
    });
  });

  // The API push worker's fan-out is a root span with no HTTP request behind
  // it, so its counts arrive on `contexts.trace.data` (#2507).
  it("keeps the push fan-out counts on a root span, and nothing beside them", () => {
    const scrubbed = browser.scrubSentryTransaction({
      transaction: "chat.push.fanout",
      contexts: {
        trace: {
          op: "chat.push",
          data: {
            "chat.push.recipients": 12,
            "chat.push.sent": 9,
            "chat.push.presence_channels": 41,
            "chat.push.channel_id": "0b7c9b1e-6f7e-4a57-9c1a-3f1e2d4c5b6a",
            "chat.push.preview": `ping ${MEMBER_EMAIL}`,
          },
        },
      },
    });

    const traceData = (
      scrubbed as {
        contexts?: { trace?: { data?: Record<string, unknown> } };
      }
    ).contexts?.trace?.data;
    expect(traceData).toEqual({
      "chat.push.recipients": 12,
      "chat.push.sent": 9,
      "chat.push.presence_channels": 41,
    });
    expect(serialize(scrubbed)).not.toContain(MEMBER_EMAIL);
  });

  it("reduces HTTP-shaped span descriptions to method + path-only (#2080)", () => {
    const ingest = "https://us.i.posthog.com/i/v1/logs";
    const credentialled = "https://svc:s3cr3t@us.i.posthog.com/i/v1/logs?token=abc";
    const scrubbed = browser.scrubSentryTransaction({
      transaction: `POST ${ingest}`,
      spans: [
        {
          span_id: "s1",
          op: "http.client",
          description: `POST ${ingest}`,
          data: {
            "http.request.method": "POST",
            "http.response.status_code": 200,
          },
        },
        {
          span_id: "s2",
          op: "http.client",
          description: `POST ${credentialled}`,
        },
      ],
      contexts: {
        trace: {
          op: "http.client",
          description: `POST ${ingest}`,
        },
      },
    });

    const json = serialize(scrubbed);
    expect(json).not.toContain("us.i.posthog.com");
    expect(json).not.toContain(ingest);
    expect(json).not.toContain("s3cr3t");
    expect(json).not.toContain("token=abc");
    expect(json).toContain("POST /i/v1/logs");
    // Span tree still survives — emptying it is the #896 failure mode.
    expect(
      (scrubbed as { spans?: unknown[] } | null)?.spans,
    ).toHaveLength(2);

    const spans = (
      scrubbed as {
        spans?: { description?: string }[];
      } | null
    )?.spans;
    expect(spans?.[0]?.description).toBe("POST /i/v1/logs");
    expect(spans?.[1]?.description).toBe("POST /i/v1/logs");
    expect(
      (scrubbed as { transaction?: string } | null)?.transaction,
    ).toBe("POST /i/v1/logs");
    expect(
      (
        scrubbed as {
          contexts?: { trace?: { description?: string } };
        } | null
      )?.contexts?.trace?.description,
    ).toBe("POST /i/v1/logs");
  });
});

describe("shared rules hold regardless of which app binds them", () => {
  it("hashes identifiers when a salt is available", () => {
    const scrubbed = salted.scrubSentryEvent({
      message: `Chapter ${USER_UUID} failed to load`,
    });

    const json = serialize(scrubbed);
    expect(json).not.toContain(USER_UUID);
    expect(json).toContain(`[id:${hex64(USER_UUID)}]`);
  });

  it("redacts key-shaped strings on both bindings", () => {
    // Assembled at runtime rather than written as a literal. The shape that makes
    // this a useful fixture is exactly the shape GitHub's push protection blocks,
    // and an allow-listing for a Stripe-key pattern is not worth one test — the
    // next real key would inherit the exemption.
    const fakeKey = ["sk", "live", "NOTAREALFIXTURE0000"].join("_");

    for (const scrubber of [browser, salted]) {
      const json = serialize(
        scrubber.scrubSentryEvent({ message: `stripe rejected ${fakeKey}` }),
      );
      expect(json).not.toContain(fakeKey);
      expect(json).toContain("[redacted:key]");
    }
  });

  it("drops non-allowlisted top-level keys and contexts", () => {
    const scrubbed = browser.scrubSentryEvent({
      level: "error",
      extra: { chatBody: CHAT_BODY },
      contexts: {
        state: { state: { draftMessage: CHAT_BODY } },
        runtime: { name: "browser" },
      },
    });

    const json = serialize(scrubbed);
    expect(json).not.toContain("dues are late");
    expect(json).not.toContain("draftMessage");
    expect(json).toContain("error");
    expect(json).toContain("browser");
  });

  /**
   * Both of these are allowlist keys, which is what makes them dangerous: the
   * copy loop puts the raw value on the outgoing event before either rebuild
   * runs, so a rebuild that *skips* on an unexpected shape ships that value
   * unread. Caught by `/diff-review` on this very change — the first draft
   * guarded with `typeof === "string"` / `Array.isArray` and returned early,
   * which reads as defensive and is in fact fail-open.
   */
  it("drops a non-string message instead of passing it through", () => {
    for (const scrubber of [browser, salted]) {
      for (const scrub of [
        scrubber.scrubSentryEvent,
        scrubber.scrubSentryTransaction,
      ]) {
        const json = serialize(
          scrub({
            message: { formatted: `invite failed for ${MEMBER_EMAIL}` },
          } as unknown as ScrubbableEvent),
        );
        expect(json).not.toContain(MEMBER_EMAIL);
        expect(json).not.toContain("formatted");
      }
    }
  });

  it("drops a non-array exception.values instead of passing it through", () => {
    const json = serialize(
      browser.scrubSentryEvent({
        exception: {
          values: { 0: { value: `token for ${MEMBER_EMAIL}` } },
        } as unknown as ScrubbableEvent["exception"],
      }),
    );

    expect(json).not.toContain(MEMBER_EMAIL);
  });

  /**
   * These two were fail-open on `main` as well, not introduced by the extraction
   * — found by sweeping every allowlist key for the same shape once the pattern
   * above turned up twice. Closed here because this module is being rewritten
   * anyway and a known hole in a security control should not survive the move.
   */
  it("drops a non-object exception rather than shipping it raw", () => {
    const json = serialize(
      browser.scrubSentryEvent({
        exception: `boom for ${MEMBER_EMAIL}` as unknown as ScrubbableEvent["exception"],
      }),
    );
    expect(json).not.toContain(MEMBER_EMAIL);
  });

  it("rebuilds transaction_info instead of copying it through", () => {
    const kept = browser.scrubSentryEvent({
      transaction_info: { source: "route" },
    }) as { transaction_info?: { source?: string } } | null;
    expect(kept?.transaction_info).toEqual({ source: "route" });

    // Free text in `source` is swept, and a non-string source is dropped whole.
    const swept = serialize(
      browser.scrubSentryEvent({ transaction_info: { source: MEMBER_EMAIL } }),
    );
    expect(swept).not.toContain(MEMBER_EMAIL);

    const dropped = serialize(
      browser.scrubSentryEvent({
        transaction_info: { source: { nested: MEMBER_EMAIL } },
      }),
    );
    expect(dropped).not.toContain(MEMBER_EMAIL);
  });

  it("fails closed by dropping the event when scrubbing throws", () => {
    const exploding = {
      get message(): string {
        throw new Error("boom");
      },
    } as unknown as ScrubbableEvent;

    expect(browser.scrubSentryEvent(exploding)).toBeNull();
    expect(browser.scrubSentryTransaction(exploding)).toBeNull();
  });
});

/**
 * URL authority on the external boundary (#1388).
 *
 * `pathOnly` used to cut only at `?`/`#` and hand the rest to `redactFreeText`,
 * which has no rule about URL authority — its e-mail pattern merely *overlaps*
 * one for some inputs. The two whole-credential leaks that produced are pinned
 * here by shape rather than by regex behaviour, because the point of the fix is
 * that the regex's behaviour stopped mattering: the authority is now removed
 * structurally, before the sweep ever runs.
 *
 * Node hands `req.url` the request line verbatim and RFC 9112 permits
 * absolute-form on any request, so these targets reach the boundary in practice
 * — they are not synthetic.
 */
describe("sentry scrubbing — URL authority", () => {
  const CREDENTIALLED = "http://svc:s3cr3t@api.frapp.live/v1/health";
  /** Password ends outside `[\w.+-]`, so EMAIL_RE matched nothing at all. */
  const TRAILING_SPECIAL = "http://svc:hunter2!@api.frapp.live/v1/health";
  /** EMAIL_RE's host half requires a dot, so a dotless host matched nothing. */
  const DOTLESS_HOST = "postgresql://postgres:s3cr3t@localhost:5432/postgres";

  it("reduces an absolute-form request url to its path", () => {
    const scrubbed = browser.scrubSentryEvent({
      request: { url: CREDENTIALLED },
    });

    expect(
      (scrubbed as { request?: { url?: string } } | null)?.request?.url,
    ).toBe("/v1/health");
    const json = serialize(scrubbed);
    expect(json).not.toContain("s3cr3t");
    expect(json).not.toContain("svc");
    expect(json).not.toContain("api.frapp.live");
  });

  it("strips userinfo the free-text sweep never matched", () => {
    for (const url of [TRAILING_SPECIAL, DOTLESS_HOST]) {
      const json = serialize(browser.scrubSentryEvent({ request: { url } }));
      expect(json).not.toContain("hunter2");
      expect(json).not.toContain("s3cr3t");
      expect(json).not.toContain("localhost");
    }
  });

  it("covers beforeSendTransaction, not just beforeSend", () => {
    const scrubbed = browser.scrubSentryTransaction({
      transaction: CREDENTIALLED,
      request: { url: DOTLESS_HOST },
    });

    expect(
      (scrubbed as { transaction?: string } | null)?.transaction,
    ).toBe("/v1/health");
    const json = serialize(scrubbed);
    expect(json).not.toContain("s3cr3t");
    expect(json).not.toContain("localhost");
  });

  it("leaves an origin-form path exactly as it is", () => {
    const scrubbed = browser.scrubSentryEvent({
      request: { url: "/v1/health" },
    });

    expect(
      (scrubbed as { request?: { url?: string } } | null)?.request?.url,
    ).toBe("/v1/health");
  });

  it("does not rewrite a `//`-leading path into a different real route", () => {
    // A protocol-relative target is not one of the four request-target forms,
    // so treating it as one would discard the first segment of a legal
    // `//`-leading path — turning `//x/v1/chapters/join` into the real route
    // `/v1/chapters/join`. That is log forgery in the function whose whole
    // subject is integrity, so the target is preserved verbatim instead.
    const scrubbed = browser.scrubSentryEvent({
      request: { url: "//x/v1/chapters/join" },
    });

    expect(
      (scrubbed as { request?: { url?: string } } | null)?.request?.url,
    ).toBe("//x/v1/chapters/join");
  });
});

/**
 * `userinfo` in a URL that reaches Sentry as *prose* rather than as a URL field
 * (#1388). `stripAuthority` covers `request.url`, the transaction name, and
 * HTTP-shaped span descriptions; a
 * driver that cannot reach its database puts the whole DSN into the message it
 * throws, and that path is free text.
 */
describe("sentry scrubbing — userinfo in free text", () => {
  it("redacts a connection string carried in an exception message", () => {
    const scrubbed = browser.scrubSentryEvent({
      exception: {
        values: [
          {
            type: "Error",
            value:
              "connect ECONNREFUSED postgresql://postgres:s3cr3t@localhost:5432/postgres",
          },
        ],
      },
    });

    const json = serialize(scrubbed);
    expect(json).not.toContain("s3cr3t");
    expect(json).toContain("[redacted:userinfo]");
    // The host and path are diagnostic and are not credentials, so they stay —
    // this is a userinfo rule, not another authority stripper.
    expect(json).toContain("localhost");
  });

  it("does not reach past the authority into a query string", () => {
    // The `@` here follows a `/`, so it belongs to EMAIL_RE, not this rule.
    const json = serialize(
      browser.scrubSentryEvent({
        message: `GET https://api.frapp.live/v1/users?email=${MEMBER_EMAIL}`,
      }),
    );

    expect(json).not.toContain(MEMBER_EMAIL);
    expect(json).not.toContain("[redacted:userinfo]");
    expect(json).toContain("api.frapp.live");
  });
});

describe("stack-frame allowlist (#889)", () => {
  /**
   * Assembled at runtime rather than written as a literal. The shape that
   * makes this a useful fixture is exactly the shape GitHub's push
   * protection blocks, and an allow-listing for a Stripe-key pattern is not
   * worth one test.
   */
  const fakeKey = ["sk", "live", "NOTAREALFIXTURE0000"].join("_");

  function frameWithSourceContext() {
    return {
      filename: "/app/src/x.ts",
      function: "handler",
      module: "x",
      lineno: 12,
      colno: 4,
      in_app: true,
      abs_path: "/app/src/x.ts",
      context_line: `const token = "${fakeKey}";`,
      pre_context: [`const unused = "${fakeKey}";`],
      post_context: [`void "${fakeKey}";`],
      vars: { password: "hunter2" },
      instruction_addr: "0xdeadbeef",
    };
  }

  it("sweeps source context and drops unknown frame fields, including vars", () => {
    const scrubbed = browser.scrubSentryEvent({
      exception: {
        values: [
          {
            type: "Error",
            value: "boom",
            stacktrace: { frames: [frameWithSourceContext()] },
          },
        ],
      },
    });

    const json = serialize(scrubbed);
    expect(json).not.toContain(fakeKey);
    expect(json).toContain("[redacted:key]");
    expect(json).not.toContain("hunter2");
    expect(json).not.toContain("instruction_addr");
    expect(json).not.toContain("0xdeadbeef");

    const frame = (
      scrubbed as {
        exception?: {
          values?: { stacktrace?: { frames?: Record<string, unknown>[] } }[];
        };
      }
    ).exception?.values?.[0]?.stacktrace?.frames?.[0];
    expect(frame).not.toHaveProperty("vars");
    expect(frame).not.toHaveProperty("instruction_addr");
    expect(frame?.function).toBe("handler");
    expect(frame?.lineno).toBe(12);
    expect(frame?.in_app).toBe(true);
  });

  it("applies the same allowlist on the transaction path", () => {
    const json = serialize(
      browser.scrubSentryTransaction({
        transaction: "/v1/chapters",
        exception: {
          values: [
            {
              type: "Error",
              value: "boom",
              stacktrace: { frames: [frameWithSourceContext()] },
            },
          ],
        },
      }),
    );

    expect(json).not.toContain(fakeKey);
    expect(json).not.toContain("hunter2");
    expect(json).not.toContain("0xdeadbeef");
  });

  it("sweeps a member email that ContextLines read back off disk", () => {
    const json = serialize(
      browser.scrubSentryEvent({
        exception: {
          values: [
            {
              type: "Error",
              value: "boom",
              stacktrace: {
                frames: [
                  {
                    filename: "/app/src/invite.ts",
                    context_line: `throw new Error("invite failed for ${MEMBER_EMAIL}");`,
                    pre_context: [`const to = "${MEMBER_EMAIL}";`],
                    post_context: [`void "${MEMBER_EMAIL}";`],
                  },
                ],
              },
            },
          ],
        },
      }),
    );

    expect(json).not.toContain(MEMBER_EMAIL);
    expect(json).toContain("[redacted:email]");
  });

  it("drops non-string source-context entries instead of passing them through", () => {
    const json = serialize(
      browser.scrubSentryEvent({
        exception: {
          values: [
            {
              type: "Error",
              value: "boom",
              stacktrace: {
                frames: [
                  {
                    filename: "/app/src/x.ts",
                    pre_context: [
                      "ok",
                      { secret: MEMBER_EMAIL },
                    ],
                    post_context: [{ body: CHAT_BODY }],
                  },
                ],
              },
            },
          ],
        },
      }),
    );

    expect(json).not.toContain(MEMBER_EMAIL);
    expect(json).not.toContain("dues are late");
    expect(json).toContain("ok");
  });
});

describe("exception-value allowlist", () => {
  it("drops unknown value fields, including raw_stacktrace and mechanism.data", () => {
    const scrubbed = browser.scrubSentryEvent({
      exception: {
        extra: `container ${MEMBER_EMAIL}`,
        values: [
          {
            type: "Error",
            value: `failed for ${MEMBER_EMAIL}`,
            module: "invite",
            thread_id: 1,
            snapshot: { body: CHAT_BODY },
            raw_stacktrace: {
              frames: [
                {
                  filename: "/app/src/x.ts",
                  vars: { password: "hunter2" },
                  context_line: `const email = "${MEMBER_EMAIL}";`,
                },
              ],
            },
            mechanism: {
              type: "generic",
              handled: false,
              data: { email: MEMBER_EMAIL, body: CHAT_BODY },
              meta: { ns_error: { domain: MEMBER_EMAIL } },
            },
            stacktrace: {
              frames: [{ filename: "/app/src/x.ts", function: "handler" }],
              registers: { rax: MEMBER_EMAIL },
            },
          },
        ],
      },
    });

    const json = serialize(scrubbed);
    expect(json).not.toContain(MEMBER_EMAIL);
    expect(json).not.toContain("dues are late");
    expect(json).not.toContain("hunter2");
    expect(json).not.toContain("snapshot");
    expect(json).not.toContain("raw_stacktrace");
    expect(json).not.toContain("registers");
    expect(json).toContain("[redacted:email]");
    expect(json).toContain("handler");

    const value = (
      scrubbed as {
        exception?: {
          values?: Record<string, unknown>[];
        };
      }
    ).exception?.values?.[0];
    expect(value).not.toHaveProperty("snapshot");
    expect(value).not.toHaveProperty("raw_stacktrace");
    expect(value?.type).toBe("Error");
    expect(value?.module).toBe("invite");
    expect(value?.thread_id).toBe(1);
    expect(value?.mechanism).toEqual({ type: "generic", handled: false });
    expect(value?.mechanism).not.toHaveProperty("data");
    expect(value?.mechanism).not.toHaveProperty("meta");
  });

  it("omits a non-string exception value instead of passing it through", () => {
    const json = serialize(
      browser.scrubSentryEvent({
        exception: {
          values: [
            {
              type: "Error",
              value: { formatted: `invite failed for ${MEMBER_EMAIL}` },
            },
          ],
        },
      }),
    );

    expect(json).not.toContain(MEMBER_EMAIL);
    expect(json).not.toContain("formatted");
    expect(json).toContain("Error");
  });

  it("drops a non-object exception entry rather than shipping it raw", () => {
    const json = serialize(
      browser.scrubSentryEvent({
        exception: {
          values: [`token for ${MEMBER_EMAIL}`, { type: "Error", value: "boom" }],
        },
      }),
    );

    expect(json).not.toContain(MEMBER_EMAIL);
    expect(json).toContain("boom");
  });

  it("applies the same exception-value allowlist on the transaction path", () => {
    const json = serialize(
      browser.scrubSentryTransaction({
        transaction: "/v1/chapters",
        exception: {
          values: [
            {
              type: "Error",
              value: "boom",
              mechanism: { type: "generic", data: { email: MEMBER_EMAIL } },
              raw_stacktrace: {
                frames: [{ vars: { email: MEMBER_EMAIL } }],
              },
            },
          ],
        },
      }),
    );

    expect(json).not.toContain(MEMBER_EMAIL);
    expect(json).not.toContain("raw_stacktrace");
  });
});

describe("breadcrumb allowlist", () => {
  it("rebuilds from an allowlist and drops data by omission", () => {
    const scrubbed = browser.scrubSentryEvent({
      breadcrumbs: [
        {
          timestamp: 1,
          type: "http",
          category: "fetch",
          level: "info",
          event_id: "abc",
          message: `GET /v1/chapters`,
          data: { body: CHAT_BODY, url: `/v1/users?email=${MEMBER_EMAIL}` },
          payload: { email: MEMBER_EMAIL },
          user: { email: MEMBER_EMAIL },
        },
      ],
    });

    const json = serialize(scrubbed);
    expect(json).not.toContain(MEMBER_EMAIL);
    expect(json).not.toContain("dues are late");
    expect(json).toContain("GET /v1/chapters");

    const crumb = (
      scrubbed as { breadcrumbs?: Record<string, unknown>[] }
    )?.breadcrumbs?.[0];
    expect(crumb).toEqual({
      timestamp: 1,
      type: "http",
      category: "fetch",
      level: "info",
      event_id: "abc",
      message: "GET /v1/chapters",
    });
    expect(crumb).not.toHaveProperty("data");
    expect(crumb).not.toHaveProperty("payload");
    expect(crumb).not.toHaveProperty("user");
  });

  it("omits a non-string breadcrumb message instead of passing it through", () => {
    const json = serialize(
      browser.scrubSentryEvent({
        breadcrumbs: [
          {
            category: "console",
            message: { formatted: `looked up ${MEMBER_EMAIL}` },
          },
        ],
      }),
    );

    expect(json).not.toContain(MEMBER_EMAIL);
    expect(json).not.toContain("formatted");
    expect(json).toContain("console");
  });

  it("drops a breadcrumb that is only a data bag", () => {
    const json = serialize(
      browser.scrubSentryEvent({
        breadcrumbs: [{ data: { email: MEMBER_EMAIL } }],
        message: "kept",
      }),
    );

    expect(json).not.toContain(MEMBER_EMAIL);
    expect(json).not.toContain("breadcrumbs");
    expect(json).toContain("kept");
  });

  it("applies the same breadcrumb allowlist on the transaction path", () => {
    const json = serialize(
      browser.scrubSentryTransaction({
        transaction: "/chat",
        breadcrumbs: [
          {
            message: "nav",
            payload: { email: MEMBER_EMAIL },
            data: { body: CHAT_BODY },
          },
        ],
      }),
    );

    expect(json).not.toContain(MEMBER_EMAIL);
    expect(json).not.toContain("dues are late");
    expect(json).toContain("nav");
  });
});


/**
 * DOM selectors (#2736).
 *
 * The browser SDK's `htmlTreeAsString` appends an element's `aria-label`,
 * `type`, `name`, `title` and `alt` values to its selector. The shapes below
 * are the SDK's own, copied from what `@sentry/nextjs` 11 produced for a
 * button labelled the way `channel-list.tsx` labels its hide control.
 */
const MEMBER_NAME = "Jo Smith";
const HIDE_LABEL = `Hide conversation with ${MEMBER_NAME}`;
const HIDE_SELECTOR = `body > button.rounded-md.px-2[aria-label="${HIDE_LABEL}"]`;
const REDUCED_HIDE_SELECTOR = "body > button.rounded-md.px-2[aria-label]";

describe("reduceSelector (#2736)", () => {
  it("keeps tag, id and class and drops every attribute value", () => {
    expect(reduceSelector(HIDE_SELECTOR)).toBe(REDUCED_HIDE_SELECTOR);
    expect(
      reduceSelector(
        `li#row-7[title="${MEMBER_NAME}"] > input.field[type="text"][name="display_name"][alt="${MEMBER_NAME}"]`,
      ),
    ).toBe("li#row-7[title] > input.field[type][name][alt]");
  });

  it("reads a value containing the element separator as one value", () => {
    expect(reduceSelector(`button[aria-label="Move ${MEMBER_NAME} > Officers"]`)).toBe(
      "button[aria-label]",
    );
  });

  it("leaves Tailwind's bracketed classes and component names alone", () => {
    expect(
      reduceSelector(
        `ChannelList > div.grid-cols-[1fr_auto] > button.data-[state=open]:bg-accent[aria-label="${HIDE_LABEL}"]`,
      ),
    ).toBe(
      "ChannelList > div.grid-cols-[1fr_auto] > button.data-[state=open]:bg-accent[aria-label]",
    );
  });

  it("passes a selector with no attribute through unchanged", () => {
    expect(reduceSelector("div.flex > button.rounded-md")).toBe(
      "div.flex > button.rounded-md",
    );
  });

  it("gives up on a value it cannot delimit, rather than guessing", () => {
    // `"]` then ` > ` inside a label reads like the end of the value, which
    // would leave `Smith"]` behind as an element.
    expect(reduceSelector(`button[aria-label="Jo"] > Smith"]`)).toBeUndefined();
    // Cut off mid-value.
    expect(reduceSelector(`button[aria-label="Hide conversation with Jo`)).toBeUndefined();
    expect(reduceSelector("")).toBeUndefined();
  });
});

/**
 * React Native touch breadcrumbs (#2982), in the shapes `@sentry/react-native`
 * 8.28 builds: `touchevents.js` `_logTouchEvent` for `touch`, and
 * `ragetap.js` `RageTapDetector.check` for `ui.multiClick`. Each touch-path
 * entry is what `getTouchedComponentInfo` returns: a component `name` when the
 * fiber has a `displayName`, and a `label` from `accessibilityLabel` /
 * `testID` / the visible text. `apps/mobile/lib/sentry/touch-breadcrumbs.spec.ts`
 * drives the real SDK code into these shapes.
 */
const RELOAD_LABEL = `Reload ${MEMBER_NAME}`;

function sdkTouchCrumb(path: Record<string, string>[], label: string) {
  return {
    timestamp: 1_700_000_000,
    category: "touch",
    type: "user",
    level: "info",
    message: `Touch event within element: ${label}`,
    data: { path },
  };
}

function sdkRageTapCrumb(path: Record<string, string>[], label: string) {
  return {
    timestamp: 1_700_000_000,
    category: "ui.multiClick",
    type: "default",
    message: label,
    data: {
      clickCount: 3,
      metric: true,
      route: "chat/[channelId]",
      node: {
        id: 0,
        tagName: path[0]?.name ?? "unknown",
        textContent: "",
        attributes: { "sentry-label": label },
      },
      path,
    },
  };
}

describe("reduceTouchBreadcrumb (#2982)", () => {
  it("names an accessibility-labelled control by its component, not its label", () => {
    const crumb = sdkTouchCrumb(
      [{ label: RELOAD_LABEL }, { name: "Pressable" }],
      RELOAD_LABEL,
    );

    const reduced = reduceTouchBreadcrumb(crumb);

    expect(JSON.stringify(reduced)).not.toContain(MEMBER_NAME);
    expect(reduced).toEqual({
      timestamp: 1_700_000_000,
      category: "touch",
      type: "user",
      level: "info",
      message: "Touch event within element: Pressable",
      data: { path: [{ name: "Pressable" }] },
    });
  });

  it("drops visible text the SDK extracted as the label", () => {
    const crumb = sdkTouchCrumb([{ name: "Text", label: CHAT_BODY }], CHAT_BODY);

    const reduced = reduceTouchBreadcrumb(crumb);

    expect(JSON.stringify(reduced)).not.toContain("dues are late");
    expect(reduced.message).toBe("Touch event within element: Text");
  });

  it("keeps an annotated component's element and source file", () => {
    const crumb = sdkTouchCrumb(
      [
        {
          name: "TaskRow",
          element: "Pressable",
          file: "task-row.tsx",
          label: `Pay dues, ${MEMBER_NAME}`,
        },
      ],
      `Pay dues, ${MEMBER_NAME}`,
    );

    const reduced = reduceTouchBreadcrumb(crumb);

    expect(reduced.message).toBe(
      "Touch event within element: TaskRow (task-row.tsx)",
    );
    expect(reduced.data).toEqual({
      path: [{ name: "TaskRow", element: "Pressable", file: "task-row.tsx" }],
    });
  });

  it("stands a placeholder in when no entry has a component name", () => {
    const reduced = reduceTouchBreadcrumb(
      sdkTouchCrumb([{ label: MEMBER_NAME }], MEMBER_NAME),
    );

    expect(reduced.message).toBe("Touch event within element: [redacted:label]");
    expect(reduced).not.toHaveProperty("data");
  });

  it("does not trust a boundary message that arrives without a path", () => {
    // Nothing to rebuild from, so the message is not kept: it may be a label.
    const reduced = reduceTouchBreadcrumb({
      category: "touch",
      message: `Touch event within element: ${MEMBER_NAME}`,
    });

    expect(reduced).toEqual({
      category: "touch",
      message: "Touch event within element: [redacted:label]",
    });
  });

  it("leaves the iOS SDK's own touch crumbs to the free-text sweep", () => {
    // sentry-cocoa records UIControl actions as `touch`, named by selector
    // (`SentryBreadcrumbTracker.swift`); `deviceContextIntegration` merges
    // them into JS events. A selector is code, so it is kept.
    const cocoaSwitch = {
      timestamp: 1_700_000_000,
      category: "touch",
      type: "user",
      level: "info",
      message: "onChange:",
      data: { view: "<RCTSwitch: 0x1>", accessibilityIdentifier: "x" },
    };

    expect(reduceTouchBreadcrumb(cocoaSwitch)).toBe(cocoaSwitch);
    expect(browser.scrubSentryEvent({ breadcrumbs: [cocoaSwitch] })?.breadcrumbs)
      .toEqual([
        {
          timestamp: 1_700_000_000,
          category: "touch",
          type: "user",
          level: "info",
          message: "onChange:",
        },
      ]);
  });

  it("rebuilds a rage tap without its label, node or route", () => {
    const crumb = sdkRageTapCrumb(
      [{ label: RELOAD_LABEL }, { name: "Pressable" }],
      RELOAD_LABEL,
    );

    const reduced = reduceTouchBreadcrumb(crumb);

    expect(JSON.stringify(reduced)).not.toContain(MEMBER_NAME);
    expect(reduced).toEqual({
      timestamp: 1_700_000_000,
      category: "ui.multiClick",
      type: "default",
      message: "Pressable",
      data: { path: [{ name: "Pressable" }], clickCount: 3 },
    });
  });

  it("drops fields it does not know at the top level too", () => {
    const reduced = reduceTouchBreadcrumb({
      ...sdkTouchCrumb([{ name: "Pressable" }], MEMBER_NAME),
      label: MEMBER_NAME,
    });

    expect(JSON.stringify(reduced)).not.toContain(MEMBER_NAME);
  });

  it("is idempotent, so the record-time and send-time passes agree", () => {
    const once = reduceTouchBreadcrumb(
      sdkRageTapCrumb([{ label: RELOAD_LABEL }, { name: "Pressable" }], RELOAD_LABEL),
    );

    expect(reduceTouchBreadcrumb(once)).toEqual(once);
  });

  it("returns any other breadcrumb as it came", () => {
    const crumb = { category: "console", message: MEMBER_NAME, data: { x: 1 } };

    expect(reduceTouchBreadcrumb(crumb)).toBe(crumb);
  });

  it("applies when an event is sent, for a crumb that skipped the record-time hook", () => {
    const scrubbed = browser.scrubSentryEvent({
      breadcrumbs: [
        sdkTouchCrumb([{ label: RELOAD_LABEL }, { name: "Pressable" }], RELOAD_LABEL),
        sdkRageTapCrumb([{ name: "Text", label: MEMBER_NAME }], MEMBER_NAME),
      ],
    });

    expect(serialize(scrubbed)).not.toContain(MEMBER_NAME);
    expect(scrubbed?.breadcrumbs).toEqual([
      {
        timestamp: 1_700_000_000,
        category: "touch",
        type: "user",
        level: "info",
        message: "Touch event within element: Pressable",
      },
      {
        timestamp: 1_700_000_000,
        category: "ui.multiClick",
        type: "default",
        message: "Text",
      },
    ]);
  });
});

/**
 * Breadcrumbs as `@sentry/browser` 10.75's breadcrumbs integration records
 * them in React Native (#3104): `_getFetchBreadcrumbHandler` (the app's
 * `fetch` is `expo/fetch`), `_getXhrBreadcrumbHandler` and
 * `_getConsoleBreadcrumbHandler`, after `@sentry/core`'s `addBreadcrumb` has
 * stamped the timestamp. `apps/mobile/lib/sentry/recorded-breadcrumbs.spec.ts`
 * drives the real handlers into these shapes.
 */
const SEARCH_URL = "https://api.frapp.live/v1/members/search?q=Jo%20Smith&limit=20";
const SEARCH_ORIGIN_AND_PATH = "https://api.frapp.live/v1/members/search";

function sdkRequestCrumb(
  category: "fetch" | "xhr",
  data: Record<string, unknown>,
) {
  return { timestamp: 1_700_000_000, category, type: "http", level: "info", data };
}

function sdkConsoleCrumb(args: unknown[], message: string) {
  return {
    timestamp: 1_700_000_000,
    category: "console",
    level: "warning",
    message,
    data: { arguments: args, logger: "console" },
  };
}

describe("scrubRecordedBreadcrumb (#3104)", () => {
  const record = browser.scrubRecordedBreadcrumb;

  it("keeps a request crumb's origin and path, and drops its query string", () => {
    const recorded = record(
      sdkRequestCrumb("fetch", {
        method: "GET",
        url: SEARCH_URL,
        status_code: 200,
      }),
    );

    expect(JSON.stringify(recorded)).not.toContain("Jo");
    expect(recorded).toEqual({
      timestamp: 1_700_000_000,
      type: "http",
      category: "fetch",
      level: "info",
      data: { method: "GET", url: SEARCH_ORIGIN_AND_PATH, status_code: 200 },
    });
  });

  it("drops the fragment and userinfo of an xhr crumb's URL, and sweeps its path", () => {
    const recorded = record(
      sdkRequestCrumb("xhr", {
        method: "GET",
        url: `https://admin:hunter2!@api.frapp.live/v1/members/${USER_UUID}/${MEMBER_EMAIL}?q=Sigma#top`,
        status_code: 404,
      }),
    );
    const serialized = JSON.stringify(recorded);

    expect(serialized).not.toContain("hunter2");
    expect(serialized).not.toContain(USER_UUID);
    expect(serialized).not.toContain(MEMBER_EMAIL);
    expect(serialized).not.toContain("Sigma");
    expect(recorded?.data).toEqual({
      method: "GET",
      url: "https://api.frapp.live/v1/members/[redacted:id]/[redacted:email]",
      status_code: 404,
    });
  });

  it("keeps the origin the SDK's own filters match on", () => {
    // `sdk.js`'s `defaultBeforeBreadcrumb`, and the native SDKs'
    // `beforeBreadcrumb`, drop an `http` crumb whose URL starts with the DSN's
    // origin or the dev server's URL. A path-only URL would match neither.
    const envelope = record(
      sdkRequestCrumb("fetch", {
        method: "POST",
        url: "https://o0.ingest.sentry.io/api/0/envelope/?sentry_key=examplepublickey&sentry_version=7",
        status_code: 200,
      }),
    );
    const metro = record(
      sdkRequestCrumb("xhr", {
        method: "POST",
        url: "http://192.168.1.20:8081/symbolicate",
        status_code: 200,
      }),
    );
    const bareOrigin = record(
      sdkRequestCrumb("fetch", { method: "GET", url: "https://api.frapp.live?q=Jo" }),
    );

    expect((envelope?.data as { url: string }).url).toBe(
      "https://o0.ingest.sentry.io/api/0/envelope/",
    );
    expect((metro?.data as { url: string }).url).toBe(
      "http://192.168.1.20:8081/symbolicate",
    );
    expect((bareOrigin?.data as { url: string }).url).toBe("https://api.frapp.live/");
  });

  it("reduces a relative URL to its path", () => {
    const recorded = record(
      sdkRequestCrumb("xhr", { method: "GET", url: "/v1/chapter-directory/search?q=Sigma" }),
    );

    expect(recorded?.data).toEqual({ method: "GET", url: "/v1/chapter-directory/search" });
  });

  it("keeps only method, URL and status on a request crumb", () => {
    const recorded = record({
      ...sdkRequestCrumb("fetch", {
        method: "POST",
        url: SEARCH_URL,
        status_code: 500,
        request: { body: CHAT_BODY },
        response: { headers: { "x-member": MEMBER_NAME } },
        "http.query": "q=Jo%20Smith",
      }),
      level: "error",
    });
    const unknownMethod = record(
      sdkRequestCrumb("xhr", { method: MEMBER_NAME, url: SEARCH_URL, status_code: "200" }),
    );

    expect(JSON.stringify(recorded)).not.toContain(MEMBER_EMAIL);
    expect(recorded?.data).toEqual({
      method: "POST",
      url: SEARCH_ORIGIN_AND_PATH,
      status_code: 500,
    });
    expect(unknownMethod?.data).toEqual({ url: SEARCH_ORIGIN_AND_PATH });
  });

  it("drops a console crumb's raw arguments and sweeps its message", () => {
    const args = [
      "search failed for",
      MEMBER_EMAIL,
      "at /v1/members/search?q=Jo%20Smith",
      { member: { name: MEMBER_NAME } },
    ];
    const recorded = record(
      sdkConsoleCrumb(
        args,
        `search failed for ${MEMBER_EMAIL} at /v1/members/search?q=Jo%20Smith [object Object]`,
      ),
    );

    expect(JSON.stringify(recorded)).not.toContain("Jo");
    expect(JSON.stringify(recorded)).not.toContain(MEMBER_EMAIL);
    expect(recorded).toEqual({
      timestamp: 1_700_000_000,
      category: "console",
      level: "warning",
      message: "search failed for [redacted:email] at /v1/members/search [object Object]",
    });
  });

  it("keeps a touch crumb's code-only path, as #2982 left it", () => {
    const recorded = record(
      sdkRageTapCrumb([{ name: "Text", label: MEMBER_NAME }], MEMBER_NAME),
    );

    expect(JSON.stringify(recorded)).not.toContain(MEMBER_NAME);
    expect(recorded).toEqual({
      timestamp: 1_700_000_000,
      category: "ui.multiClick",
      type: "default",
      message: "Text",
      data: { path: [{ name: "Text" }], clickCount: 3 },
    });
  });

  it("keeps a navigation crumb's from and to, which native reads for the current screen", () => {
    // `reactnavigation.js`, registered by the SDK's Expo Router integration,
    // with the templated path Expo Router hands it as the route name.
    const routed = record({
      timestamp: 1_700_000_000,
      category: "navigation",
      type: "navigation",
      message: "Navigation to /members/[id]",
      data: { from: "/(tabs)/chat", to: "/members/[id]" },
    });
    // The browser SDK's history crumb, the one shape that carries a concrete
    // path, query string included.
    const concrete = record({
      timestamp: 1_700_000_000,
      category: "navigation",
      data: {
        from: "/directory",
        to: `/members/${USER_UUID}?q=Jo%20Smith#notes`,
      },
    });

    expect(routed?.data).toEqual({ from: "/(tabs)/chat", to: "/members/[id]" });
    expect(JSON.stringify(concrete)).not.toContain("Jo");
    expect(concrete?.data).toEqual({
      from: "/directory",
      to: "/members/[redacted:id]",
    });
  });

  it("drops any other navigation data and unknown fields", () => {
    // `expoRouter.js`'s own crumb: `pathname` and `params` are not what
    // native reads, and `params` holds route values.
    const recorded = record({
      timestamp: 1_700_000_000,
      category: "navigation",
      type: "navigation",
      message: `Expo Router push to /members/${USER_UUID}`,
      origin: "auto.navigation.expo_router",
      data: { method: "push", pathname: `/members/${USER_UUID}`, params: { q: "Jo" } },
      payload: MEMBER_NAME,
    });

    expect(recorded).toEqual({
      timestamp: 1_700_000_000,
      type: "navigation",
      category: "navigation",
      message: "Expo Router push to /members/[redacted:id]",
    });
  });

  it("is idempotent, and the send-time pass over a recorded crumb only drops data", () => {
    const crumbs = [
      sdkRequestCrumb("fetch", { method: "GET", url: SEARCH_URL, status_code: 200 }),
      sdkConsoleCrumb([MEMBER_EMAIL], `ping ${MEMBER_EMAIL}`),
      sdkTouchCrumb([{ label: RELOAD_LABEL }, { name: "Pressable" }], RELOAD_LABEL),
    ];

    for (const crumb of crumbs) {
      const once = record(crumb);
      expect(record(once)).toEqual(once);

      const sent = browser.scrubSentryEvent({ breadcrumbs: [once] });
      const withoutData = Object.fromEntries(
        Object.entries(once ?? {}).filter(([key]) => key !== "data"),
      );
      expect(sent?.breadcrumbs).toEqual([withoutData]);
    }
  });

  it("drops a crumb it cannot read rather than letting it through", () => {
    const hostile = {
      timestamp: 1_700_000_000,
      category: "fetch",
      type: "http",
      get data(): never {
        throw new Error(SEARCH_URL);
      },
    };

    expect(record(hostile)).toBeNull();
  });

  it("returns null for a crumb with nothing to keep", () => {
    expect(record(null)).toBeNull();
    expect(record("console")).toBeNull();
    expect(record({ data: { arguments: [MEMBER_NAME] } })).toBeNull();
  });
});

describe("DOM selectors in breadcrumbs and names (#2736)", () => {
  it("reduces a ui.click breadcrumb's selector", () => {
    const scrubbed = browser.scrubSentryEvent({
      breadcrumbs: [
        {
          category: "ui.click",
          message: HIDE_SELECTOR,
          data: { "ui.component_name": "ChannelList" },
        },
        { category: "ui.input", message: `input.field[name="${MEMBER_NAME}"]` },
      ],
    });

    expect(serialize(scrubbed)).not.toContain(MEMBER_NAME);
    expect(scrubbed?.breadcrumbs).toEqual([
      { category: "ui.click", message: REDUCED_HIDE_SELECTOR },
      { category: "ui.input", message: "input.field[name]" },
    ]);
  });

  it("replaces a ui breadcrumb selector it cannot reduce", () => {
    const scrubbed = browser.scrubSentryEvent({
      breadcrumbs: [
        { category: "ui.click", message: `button[aria-label="Jo"] > Smith"]` },
      ],
    });

    expect(serialize(scrubbed)).not.toContain("Smith");
    expect(scrubbed?.breadcrumbs).toEqual([
      { category: "ui.click", message: "[redacted:selector]" },
    ]);
  });

  it("leaves other breadcrumb messages to the free-text sweep", () => {
    // React Native's `touch` and `ui.multiClick` crumbs carry a label, not a
    // selector; their rule is `reduceTouchBreadcrumb` (#2982), above.
    const scrubbed = browser.scrubSentryEvent({
      breadcrumbs: [{ category: "console", message: 'lookup [status="404"]' }],
    });

    expect(scrubbed?.breadcrumbs).toEqual([
      { category: "console", message: 'lookup [status="404"]' },
    ]);
  });

  it("reduces selector-named spans, transactions and the DSC transaction", () => {
    const scrubbed = browser.scrubSentryTransaction({
      transaction: HIDE_SELECTOR,
      contexts: { trace: { description: HIDE_SELECTOR, op: "ui.interaction.click" } },
      sdkProcessingMetadata: {
        dynamicSamplingContext: { trace_id: "abc", transaction: HIDE_SELECTOR },
      },
      spans: [
        {
          span_id: "1",
          op: "ui.interaction.click",
          description: HIDE_SELECTOR,
          data: { "browser.web_vital.inp.target": HIDE_SELECTOR },
        },
      ],
    });

    expect(serialize(scrubbed)).not.toContain(MEMBER_NAME);
    expect(scrubbed?.transaction).toBe(REDUCED_HIDE_SELECTOR);
    const spans = scrubbed?.spans as Record<string, unknown>[];
    expect(spans[0]?.description).toBe(REDUCED_HIDE_SELECTOR);
    expect(spans[0]?.data).toEqual({});
    expect(
      (scrubbed?.sdkProcessingMetadata as Record<string, Record<string, unknown>>)
        .dynamicSamplingContext?.transaction,
    ).toBe(REDUCED_HIDE_SELECTOR);
  });
});

/**
 * The INP envelope as `@sentry/nextjs` 11 builds it for a standalone span
 * that roots its own trace, trimmed to the fields that matter. Measured from
 * the SDK under jsdom; `apps/web/lib/sentry/inp-trace-root.envelope.spec.ts`
 * drives the real one.
 */
function inpEnvelope(): [Record<string, unknown>, [Record<string, unknown>, unknown][]] {
  const attribute = (value: unknown, type = "string") => ({ value, type });
  return [
    {
      sent_at: "2026-09-30T19:08:43.821Z",
      trace: {
        environment: "production",
        public_key: "fixturekey",
        trace_id: "efe858088a6240be9ddd9a18fe2cef92",
        sampled: "true",
        sample_rate: "1",
        transaction: HIDE_SELECTOR,
        replay_id: "not-on-the-allowlist",
      },
      sdk: { name: "sentry.javascript.nextjs", version: "11.0.0" },
    },
    [
      [
        {
          type: "span",
          item_count: 1,
          content_type: "application/vnd.sentry.items.span.v2+json",
        },
        {
          version: 2,
          ingest_settings: { infer_ip: "auto", infer_user_agent: "auto" },
          items: [
            {
              name: HIDE_SELECTOR,
              span_id: "9628524128ca8436",
              trace_id: "efe858088a6240be9ddd9a18fe2cef92",
              start_timestamp: 1790795322.9,
              end_timestamp: 1790795323.14,
              is_segment: true,
              status: "ok",
              links: [{ attributes: { note: attribute(MEMBER_EMAIL) } }],
              attributes: {
                "sentry.origin": attribute("auto.http.browser.inp"),
                "sentry.op": attribute("ui.interaction.click"),
                "sentry.exclusive_time": attribute(240, "integer"),
                "browser.web_vital.inp.value": attribute(240, "integer"),
                "browser.web_vital.inp.target": attribute(HIDE_SELECTOR),
                "browser.web_vital.inp.interaction_type": attribute("click"),
                "sentry.segment.name": attribute(HIDE_SELECTOR),
                "sentry.segment.id": attribute("9628524128ca8436"),
                "user_agent.original": attribute("Mozilla/5.0 (X11; Linux x86_64)"),
                "url.full": attribute(`https://app.frapp.live/chat/${USER_UUID}?invite=tok`),
                "culture.timezone": attribute("America/New_York"),
              },
            },
          ],
        },
      ],
    ],
  ];
}

describe("scrubSentryEnvelope (#2736)", () => {
  it("rebuilds the trace header with the selector reduced", () => {
    const envelope = inpEnvelope();
    browser.scrubSentryEnvelope(envelope);

    expect(envelope[0].trace).toEqual({
      environment: "production",
      public_key: "fixturekey",
      trace_id: "efe858088a6240be9ddd9a18fe2cef92",
      sampled: "true",
      sample_rate: "1",
      transaction: REDUCED_HIDE_SELECTOR,
    });
    // Other header keys are the SDK's, and stay.
    expect(envelope[0].sent_at).toBe("2026-09-30T19:08:43.821Z");
    expect(envelope[0].sdk).toEqual({
      name: "sentry.javascript.nextjs",
      version: "11.0.0",
    });
  });

  it("rebuilds a standalone span from the allowlist", () => {
    const envelope = inpEnvelope();
    browser.scrubSentryEnvelope(envelope);

    expect(serialize(envelope as unknown as ScrubbableEvent)).not.toContain(MEMBER_NAME);
    expect(serialize(envelope as unknown as ScrubbableEvent)).not.toContain(MEMBER_EMAIL);
    const [itemHeader, payload] = envelope[1][0]!;
    expect(itemHeader.item_count).toBe(1);
    expect(payload).toEqual({
      version: 2,
      ingest_settings: { infer_ip: "never", infer_user_agent: "never" },
      items: [
        {
          name: REDUCED_HIDE_SELECTOR,
          span_id: "9628524128ca8436",
          trace_id: "efe858088a6240be9ddd9a18fe2cef92",
          start_timestamp: 1790795322.9,
          end_timestamp: 1790795323.14,
          is_segment: true,
          status: "ok",
          attributes: {
            "sentry.origin": { value: "auto.http.browser.inp", type: "string" },
            "sentry.op": { value: "ui.interaction.click", type: "string" },
            "sentry.exclusive_time": { value: 240, type: "integer" },
            "browser.web_vital.inp.value": { value: 240, type: "integer" },
            "browser.web_vital.inp.target": {
              value: REDUCED_HIDE_SELECTOR,
              type: "string",
            },
            "browser.web_vital.inp.interaction_type": {
              value: "click",
              type: "string",
            },
            "sentry.segment.name": { value: REDUCED_HIDE_SELECTOR, type: "string" },
            "sentry.segment.id": { value: "9628524128ca8436", type: "string" },
            "url.full": { value: "/chat/[redacted:id]", type: "string" },
          },
        },
      ],
    });
  });

  it("leaves event items and envelopes without a span alone", () => {
    const event = { event_id: "e1", message: "already scrubbed by beforeSend" };
    const envelope: [Record<string, unknown>, [Record<string, unknown>, unknown][]] = [
      { event_id: "e1", sent_at: "now" },
      [[{ type: "event" }, event]],
    ];
    browser.scrubSentryEnvelope(envelope);

    expect(envelope).toEqual([
      { event_id: "e1", sent_at: "now" },
      [[{ type: "event" }, event]],
    ]);
    expect(envelope[1][0]![1]).toBe(event);
  });

  it("drops a span attribute whose type it does not know", () => {
    const envelope = inpEnvelope();
    const span = (
      envelope[1][0]![1] as { items: { attributes: Record<string, unknown> }[] }
    ).items[0]!;
    span.attributes["sentry.op"] = { value: "ui.interaction.click", type: "object" };
    browser.scrubSentryEnvelope(envelope);

    const [, payload] = envelope[1][0]!;
    expect(
      (payload as { items: { attributes: Record<string, unknown> }[] }).items[0]!
        .attributes,
    ).not.toHaveProperty("sentry.op");
  });

  it("removes a span item it cannot read, and one that throws", () => {
    const hostile = {
      version: 2,
      get items(): unknown[] {
        throw new Error("hostile getter");
      },
    };
    const envelope: [Record<string, unknown>, [Record<string, unknown>, unknown][]] = [
      { trace: { trace_id: "abc", transaction: HIDE_SELECTOR } },
      [
        [{ type: "span", item_count: 1 }, { name: HIDE_SELECTOR }],
        [{ type: "span", item_count: 1 }, hostile],
        [{ type: "span", item_count: 1 }, { version: 2, items: [] }],
      ],
    ];
    browser.scrubSentryEnvelope(envelope);

    expect(envelope[1]).toEqual([]);
    expect(envelope[0].trace).toEqual({
      trace_id: "abc",
      transaction: REDUCED_HIDE_SELECTOR,
    });
  });

  it("ignores what is not an envelope", () => {
    expect(() => browser.scrubSentryEnvelope(undefined)).not.toThrow();
    expect(() => browser.scrubSentryEnvelope({ trace: HIDE_SELECTOR })).not.toThrow();
    expect(() => browser.scrubSentryEnvelope([null, null])).not.toThrow();
  });
});
