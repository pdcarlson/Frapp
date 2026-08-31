import { describe, expect, it } from "vitest";
import {
  createSentryScrubber,
  NO_PSEUDONYMS,
  type ScrubbableEvent,
  type SentryPseudonymizer,
} from "./sentry-scrubbing";
import { hashUserIdForAnalytics } from "./analytics";

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

const SALT = "test-salt-for-shared-scrubbing";
const USER_UUID = "3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b";
const MEMBER_EMAIL = "treasurer@chapter.example.edu";
const CHAT_BODY = "Reminder: dues are late, ping treasurer@chapter.example.edu";

/** The web binding: no salt, so nothing can be hashed. */
const browser = createSentryScrubber(NO_PSEUDONYMS);

/** A server-shaped binding, to pin the with-salt branch of the same code. */
const saltedPseudonyms: SentryPseudonymizer = {
  pseudonymizeUserId: (id) =>
    typeof id === "string" && id ? hashUserIdForAnalytics(SALT, id) : undefined,
  pseudonymizeIp: (ip) =>
    typeof ip === "string" && ip ? hashUserIdForAnalytics(SALT, ip) : undefined,
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
    const pseudonym = hashUserIdForAnalytics(SALT, USER_UUID);

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
});

describe("shared rules hold regardless of which app binds them", () => {
  it("hashes identifiers when a salt is available", () => {
    const scrubbed = salted.scrubSentryEvent({
      message: `Chapter ${USER_UUID} failed to load`,
    });

    const json = serialize(scrubbed);
    expect(json).not.toContain(USER_UUID);
    expect(json).toContain(`[id:${hashUserIdForAnalytics(SALT, USER_UUID)}]`);
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
 * (#1388). `stripAuthority` covers `request.url` and the transaction name; a
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
