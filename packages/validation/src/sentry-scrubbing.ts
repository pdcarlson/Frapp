/**
 * PII scrubbing for everything leaving a Frapp process for Sentry (#481, #896,
 * #865).
 *
 * `spec/behavior/observability.md` § Error Tracking splits identifiers into two
 * classes, and this module is the single enforcement point for both — across
 * **both event classes**, and now across **both apps**. The SDK routes those
 * classes to two different hooks, so {@link createSentryScrubber} returns two
 * entry points: `scrubSentryEvent` for `beforeSend` (error events) and
 * `scrubSentryTransaction` for `beforeSendTransaction` (tracing events).
 *
 * They cannot be the same function. `spans` is absent from
 * {@link EVENT_KEY_ALLOWLIST}, so pointing `beforeSendTransaction` at
 * `scrubSentryEvent` would deliver every transaction with its trace payload
 * silently emptied — the event still arrives, so nothing looks broken (#896).
 *
 * The two classes:
 *
 *  - **Pseudonymized:** `user_id` and `chapter_id` → HMAC-SHA256 under the
 *    per-environment analytics salt.
 *  - **Redacted entirely:** emails, IP addresses, auth tokens (including any
 *    `Authorization` header value), request bodies, response bodies, message
 *    contents, document contents, and free-text fields that may contain
 *    user-typed PII.
 *
 * The design principle is **allowlist, not denylist**, everywhere a structure
 * is enumerable — headers, request fields, top-level event keys. A denylist
 * silently starts leaking the day Sentry's SDK adds a field, and the failure is
 * invisible because nobody reads their own error reports looking for PII.
 *
 * Free text is the one place an allowlist is impossible: an exception message
 * is the payload we actually want, and dropping it would make the whole
 * integration pointless. Those strings get a redaction sweep instead
 * (`redactFreeText`), which is best-effort by construction and is the weakest
 * link here by design — hence the strictness everywhere else.
 *
 * ## Why this lives in `@repo/validation`, and why it takes its pseudonymizer
 *
 * It was `apps/api/src/infrastructure/observability/sentry-scrubbing.ts` until
 * #865 needed the identical rules on the browser side. A browser bundle holds
 * strictly *more* PII than the server does — member emails, chapter names, chat
 * message bodies, document titles — so wiring web Sentry against a second,
 * looser copy of these rules would reintroduce on the client exactly the leak
 * #481 closed on the server.
 *
 * Two constraints follow from the move, and they are why this module looks
 * different from the one it replaced:
 *
 *  - **No `@sentry/*` import, not even `import type`.** `@repo/validation` is
 *    also a dependency of `apps/mobile`, which has no Sentry installed; a
 *    type-only import still lands in the emitted `.d.ts` and would fail to
 *    resolve there. The event shapes below are therefore structural. Each app
 *    binds them to its own SDK's types at the wiring site, which is where a
 *    breaking SDK change should surface anyway — `buildSentryOptions` in the
 *    API stops compiling if `beforeSend`'s signature moves.
 *  - **No `process.env`.** The salt is API-only on purpose (`ENV_REFERENCE.md`:
 *    exposing it to a client bundle would let the dataset be rainbow-tabled
 *    back to user ids). So the pseudonymizer is injected rather than imported,
 *    and a caller that has no salt passes one that returns `undefined` — which
 *    is the fail-closed path this module already took when the API's salt was
 *    unset, not new behavior.
 */

// ── Injected pseudonymization ────────────────────────────────────────────────

/**
 * The two pseudonym lookups the sweep needs.
 *
 * Both return `undefined` when a pseudonym cannot be derived, and every call
 * site treats that as "drop the value" rather than "pass it through". That is
 * the contract: there is no third outcome in which a raw identifier survives.
 *
 * The browser implementation returns `undefined` unconditionally — it holds no
 * salt and must not — so web events carry `[redacted:id]` where API events
 * carry `[id:<hmac>]`.
 */
export interface SentryPseudonymizer {
  /** Pseudonymous user/chapter/row key, or `undefined`. Never the raw id. */
  pseudonymizeUserId(userId: unknown): string | undefined;
  /** Pseudonymous request-origin key, or `undefined`. Never the raw address. */
  pseudonymizeIp(ip: unknown): string | undefined;
}

/**
 * The pseudonymizer for a process that holds no salt, and must not.
 *
 * Named rather than inlined so the web wiring reads as a deliberate choice
 * ("this environment cannot pseudonymize") instead of an omission.
 */
export const NO_PSEUDONYMS: SentryPseudonymizer = {
  pseudonymizeUserId: () => undefined,
  pseudonymizeIp: () => undefined,
};

// ── Structural event shapes ──────────────────────────────────────────────────

/**
 * The parts of a Sentry event this module reads, described structurally.
 *
 * Deliberately permissive: the index signature is what lets an SDK's real
 * `ErrorEvent` / transaction event be passed in without this package importing
 * the SDK. Every field is treated as untrusted regardless of its declared type
 * — the scrubbers re-check `typeof` before using anything, because a declared
 * `string` from a third-party SDK is a claim, not a guarantee.
 */
export interface ScrubbableEvent {
  exception?: { values?: unknown[]; [key: string]: unknown };
  message?: unknown;
  transaction?: unknown;
  tags?: Record<string, unknown>;
  contexts?: Record<string, unknown>;
  fingerprint?: unknown;
  request?: Record<string, unknown>;
  breadcrumbs?: unknown[];
  user?: { id?: unknown; [key: string]: unknown };
  spans?: unknown;
  measurements?: unknown;
  sdkProcessingMetadata?: unknown;
  [key: string]: unknown;
}

/** Request headers worth keeping. Everything else is dropped unread. */
const HEADER_ALLOWLIST = new Set(['content-type', 'x-request-id']);

/**
 * Top-level event keys that may survive. Sentry's own envelope metadata plus
 * the fields we deliberately populate.
 *
 * `user`, `request`, `breadcrumbs`, `fingerprint`, and `transaction_info` are
 * absent on purpose: they are rebuilt field-by-field below rather than passed
 * through. Leaving `fingerprint` out means a non-array one is dropped rather
 * than copied raw — the SDK types it `string[]`, so anything else is already
 * anomalous.
 *
 * `transaction_info` was on this list until #865 and was never rebuilt, so
 * whatever an integration put in it shipped verbatim. It is a one-key struct the
 * SDK fills with an enum, which is exactly the kind of "cannot be a problem
 * today" this module refuses to rely on.
 */
const EVENT_KEY_ALLOWLIST = new Set([
  'event_id',
  'timestamp',
  'start_timestamp',
  'level',
  'platform',
  'logger',
  'server_name',
  'release',
  'dist',
  'environment',
  'sdk',
  'type',
  'transaction',
  'exception',
  'message',
  'tags',
  'contexts',
  'modules',
]);

/**
 * Contexts Sentry populates with runtime/infra facts (no user data). Anything
 * else — including the `state` context some integrations attach — is dropped.
 */
const CONTEXT_ALLOWLIST = new Set([
  'trace',
  'runtime',
  'os',
  'device',
  'culture',
  'app',
  'cloud_resource',
]);

// ── Free-text redaction ──────────────────────────────────────────────────────

/**
 * A URL — absolute or a bare path — together with its query string.
 *
 * Query strings are the single most common place a token turns up in free
 * text: an http breadcrumb's message, a fetch error, a logged upstream URL.
 * Stripping the query wherever a URL appears in prose is stricter than
 * stripping `request.url` alone, which is what a structural scrubber would
 * catch. Anchored on `/` or a scheme so ordinary prose ending in a question
 * mark is left alone.
 */
const URL_QUERY_RE = /((?:https?:\/\/[^\s?#]*|\/[^\s?#]*)\?)\S*/g;
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
/**
 * `userinfo` in a URL that appears inside free text (#1388).
 *
 * {@link stripAuthority} covers the two *structural* URL fields — `request.url`
 * and the transaction name — but an exception message or a breadcrumb is prose,
 * and a connection string lands there routinely: a driver that cannot reach its
 * database puts the whole DSN in the error it throws. Nothing else in this
 * chain catches it. {@link EMAIL_RE} is the near-miss that makes it look
 * covered — it consumes the run of `[\w.+-]` before the `@`, so it takes part
 * of some passwords, none of others, and never the ones on a dotless host.
 *
 * Matching stops at `/`, whitespace and a second `@`, so it cannot reach past
 * the authority into a path or query — `…/v1/users?email=a@b.com` has its `@`
 * after a `/` and is left to `EMAIL_RE`. Requiring `://` keeps `mailto:` and
 * bare prose out. Runs before `EMAIL_RE` so the e-mail pattern cannot consume
 * half the credential first and leave the rest unmatchable.
 */
const URL_USERINFO_RE = /([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)[^/\s@]+@/g;

/**
 * An absolute-form or otherwise authority-bearing target, reduced to its path.
 *
 * Hoisted here from `apps/api/src/interface/utils/path-only.ts` (#1388) so the
 * internal log stream and this external boundary share one implementation.
 * They had diverged, and the divergence ran the wrong way: the API-side helper
 * stripped the authority and this one did not, leaving the *third-party* sink
 * — the one with the stricter threat model — as the leaky half.
 *
 * The justification once offered for the divergence was that this file's
 * `redactFreeText` covers userinfo. It does not. `redactFreeText` has no rule
 * about URL authority at all; {@link EMAIL_RE} sometimes *overlaps* one, which
 * is a different thing and fails in two directions:
 *
 *   - it consumes the run of `[\w.+-]` immediately before the `@`, so a
 *     password ending in any other character (`hunter2!`) is left intact along
 *     with the host, and
 *   - its host half requires a literal `.`, so a dotless internal host matches
 *     nothing whatsoever — `postgresql://postgres:s3cr3t@localhost:5432/db`
 *     passed through byte-for-byte, and an internal service URL is exactly the
 *     shape that carries a real credential in userinfo.
 *
 * Stripping the authority structurally makes both cases moot, which is why
 * this is a parser and not another pattern. Measured cases live on #1388.
 *
 * Absolute-form is a real inbound shape, not a defensive nicety: RFC 9112
 * permits `GET http://host/path HTTP/1.1` on any request, not just to a proxy,
 * and Node hands `req.url` the request line verbatim. Verified against the
 * Express version in this repo — such a request arrives with `req.url` intact
 * while `req.path` is already `/v1/health`, so anything reading `req.url`
 * sees the authority.
 *
 * Reducing it also keeps grouping honest on both sinks: absolute-form records
 * would otherwise never group with the origin-form records for the same route,
 * which is exactly when someone is probing.
 */
export function stripAuthority(path: string): string {
  // Origin-form, the overwhelmingly common case: already just a path. This
  // includes a `//`-leading target, which is a legal origin-form path — RFC
  // 9112's `absolute-path` is `1*( "/" segment )` and a segment may be empty.
  //
  // A protocol-relative target (`//host/path`) is deliberately NOT handled.
  // It is not one of the four request-target forms, so it cannot legitimately
  // arrive; treating it as one meant discarding the first segment of any legal
  // `//`-leading path, which is strictly worse than the leak this fixes.
  // `GET //x/v1/chapters/join` 404s but would have been reported as
  // `/v1/chapters/join` — a real route, indistinguishable from a genuine
  // request, which is forgery in the function whose subject is integrity.
  if (path.startsWith('/')) return path;

  const afterScheme = path.match(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/(.*)$/);

  // Not absolute-form — asterisk-form (`OPTIONS *`) or authority-form
  // (`CONNECT host:port`). Neither carries a path to recover, and neither
  // should be rewritten into something that looks like one.
  if (!afterScheme) return path;

  // `(.*)` always participates when the match succeeds, so the fallback is
  // unreachable — it is here because this package compiles under
  // `noUncheckedIndexedAccess`, unlike `apps/api` where this parser was born.
  const authorityAndPath = afterScheme[1] ?? '';
  const slash = authorityAndPath.indexOf('/');
  return slash === -1 ? '/' : authorityAndPath.slice(slash);
}
/** `Bearer <jwt|opaque>`, and bare three-segment JWTs wherever they appear. */
const BEARER_RE = /\bBearer\s+[\w\-._~+/]+=*/gi;
const JWT_RE = /\beyJ[\w-]*\.[\w-]+\.[\w-]+/g;
/**
 * Supabase/Stripe-shaped API keys and the project's own secret prefixes.
 * The body allows `_` because every real key has one (`sk_live_…`, `sk_test_…`)
 * and stopping at the first underscore would match four harmless characters.
 */
const KEYLIKE_RE = /\b(?:sk|pk|rk|whsec|sbp)_[A-Za-z0-9_]{8,}/g;
const UUID_RE =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const IPV4_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
/**
 * IPv6, in the two shapes that actually occur: the full eight groups, or any
 * `::`-compressed form with at least one hex group attached.
 *
 * Requiring either eight groups or a literal `::` is what keeps `12:30:45` — a
 * clock time, three colon-separated runs of valid hex — out of the match. A
 * looser "two or more colon-separated hex groups" pattern silently rewrites
 * every timestamp in every log line it touches.
 */
const IPV6_RE =
  /\b(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}\b|\b[0-9a-f]{1,4}::(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4})*)?|(?<![0-9a-f:])::[0-9a-f]{1,4}(?::[0-9a-f]{1,4})*/gi;

/**
 * The complete scrubber for one process, bound to that process's pseudonymizer.
 *
 * A factory rather than free functions because {@link redactFreeText} needs the
 * pseudonymizer too — UUIDs and IPs inside an exception message are hashed in
 * place, not just the structured fields — and threading it through every
 * internal helper as a parameter would put it in a dozen signatures that exist
 * for other reasons.
 */
export function createSentryScrubber(pseudonyms: SentryPseudonymizer): {
  redactFreeText: (input: string) => string;
  scrubSentryEvent: (event: ScrubbableEvent) => ScrubbableEvent | null;
  scrubSentryTransaction: (event: ScrubbableEvent) => ScrubbableEvent | null;
} {
  /**
   * Best-effort PII sweep over a free-text string (exception messages, culprits,
   * transaction names, breadcrumb messages).
   *
   * UUIDs are **pseudonymized rather than dropped** wherever a salt is
   * available. Every UUID the API handles is a user, chapter, or row id drawn
   * from the same salt namespace, so hashing one in a message yields
   * byte-identical output to the `user`/`chapter` tags on the same event. An
   * operator can therefore still answer "is this the tenant from the other
   * error?" from the message alone — which is most of why the message is worth
   * keeping — while the raw id never leaves the process. Where no salt exists
   * (the browser) the same call returns `undefined` and the id is replaced by a
   * placeholder instead: correlation is lost, the identifier still never ships.
   *
   * Order matters: JWTs and key-shaped strings are consumed before the generic
   * sweeps so a token containing a dotted-quad-looking run is not partially
   * rewritten into something unrecognizable.
   */
  function redactFreeText(input: string): string {
    return input
      .replace(URL_QUERY_RE, (_match, uptoQuestionMark: string) =>
        uptoQuestionMark.slice(0, -1),
      )
      .replace(URL_USERINFO_RE, '$1[redacted:userinfo]@')
      .replace(BEARER_RE, '[redacted:token]')
      .replace(JWT_RE, '[redacted:token]')
      .replace(KEYLIKE_RE, '[redacted:key]')
      .replace(EMAIL_RE, '[redacted:email]')
      .replace(UUID_RE, (uuid) => {
        const hashed = pseudonyms.pseudonymizeUserId(uuid.toLowerCase());
        return hashed ? `[id:${hashed}]` : '[redacted:id]';
      })
      .replace(IPV4_RE, (ip) => {
        const hashed = pseudonyms.pseudonymizeIp(ip);
        return hashed ? `[ip:${hashed}]` : '[redacted:ip]';
      })
      .replace(IPV6_RE, (ip) => {
        const hashed = pseudonyms.pseudonymizeIp(ip);
        return hashed ? `[ip:${hashed}]` : '[redacted:ip]';
      });
  }

  function redactMaybe(value: unknown): string | undefined {
    return typeof value === 'string' ? redactFreeText(value) : undefined;
  }

  /**
   * Write the swept `message` onto the outgoing event, or remove it.
   *
   * `message` is on {@link EVENT_KEY_ALLOWLIST}, so by the time either hook gets
   * here the copy loop has already put the **raw** value on `scrubbed`. A guard
   * of the form `if (typeof message === 'string') scrubbed.message = redact(…)`
   * therefore does the opposite of what it looks like: on a non-string it skips
   * the rebuild and leaves the raw value in place.
   *
   * `Event.message` is typed `string`, but a `ParameterizedString` or a
   * structured `{ formatted, params }` from an integration is a shape the SDK's
   * own types have carried before, and this module allowlists precisely so that
   * "the SDK does not do that today" is never load-bearing. Anything that is not
   * a string is deleted rather than stringified — coercing would emit
   * `[object Object]` and, worse, `String()` on a value with a hostile `toString`
   * runs foreign code inside the one function that must not throw.
   */
  /**
   * `transaction_info`, rebuilt down to its one meaningful field.
   *
   * The SDK fills `source` from a fixed vocabulary (`url` / `route` / `custom` /
   * …), so this is close to a no-op in practice — but it is a free-form object on
   * the wire, and it is worth keeping because that `source` value is what Sentry
   * groups URL transactions by. Swept like any other author-reachable string.
   */
  function scrubTransactionInfo(info: unknown): Record<string, unknown> | undefined {
    if (!info || typeof info !== 'object') return undefined;
    const source = (info as Record<string, unknown>).source;
    if (typeof source !== 'string') return undefined;
    return { source: redactFreeText(source) };
  }

  function scrubMessageInto(
    scrubbed: Record<string, unknown>,
    message: unknown,
  ): void {
    if (typeof message === 'string') {
      scrubbed.message = redactFreeText(message);
    } else if (message !== undefined) {
      delete scrubbed.message;
    }
  }

  /**
   * Path without query, fragment, or authority.
   *
   * Both halves are load-bearing and neither substitutes for the other.
   * Dropping the query removes the tokens that routinely ride in it; dropping
   * the authority via {@link stripAuthority} removes `userinfo`, which
   * `redactFreeText` never had a rule for (#1388).
   */
  function pathOnly(url: unknown): string | undefined {
    if (typeof url !== 'string' || !url) return undefined;
    const cut = url.search(/[?#]/);
    const trimmed = cut === -1 ? url : url.slice(0, cut);
    return redactFreeText(stripAuthority(trimmed));
  }

  // ── Structural scrubbing ───────────────────────────────────────────────────

  function scrubException(exception: unknown): unknown {
    // Not an object — so not a shape this module can read, so it does not ship.
    // Returning it (which is what the API module did before the move, via
    // `if (!exception?.values) return exception`) leaves the allowlist-copied raw
    // value on the event: a bare string `exception` carried its contents out
    // untouched. Pre-existing rather than introduced here, but the same
    // fail-open shape as the two below, so it is closed with them.
    if (!exception || typeof exception !== 'object') return undefined;
    const source = exception as { values?: unknown };
    // `values` present but not an array cannot be walked — so it is **dropped**,
    // never returned as-is. `exception` is on the key allowlist, which means the
    // copy loop in the callers has already placed the raw object on the outgoing
    // event; returning it unchanged here would ship an uninspected payload
    // rather than skip a rebuild. An early `return exception` on a shape this
    // module cannot read is fail-open, which is precisely backwards.
    if ('values' in source && !Array.isArray(source.values)) {
      const kept = { ...(source as Record<string, unknown>) };
      delete kept.values;
      return kept;
    }
    if (!Array.isArray(source.values)) return exception;
    return {
      ...source,
      values: source.values.map((entry) => {
        if (!entry || typeof entry !== 'object') return entry;
        const value = entry as Record<string, unknown>;
        const stacktrace = value.stacktrace as
          | { frames?: unknown }
          | undefined
          | null;
        return {
          ...value,
          value: redactMaybe(value.value) ?? value.value,
          // Stack frames keep file/line/function (code identity, not user data)
          // but `vars` is a snapshot of local variables — arbitrary request
          // payload.
          stacktrace: stacktrace && {
            ...stacktrace,
            frames: Array.isArray(stacktrace.frames)
              ? stacktrace.frames.map((frame) => {
                  if (!frame || typeof frame !== 'object') return frame;
                  const kept = { ...(frame as Record<string, unknown>) };
                  delete kept.vars;
                  kept.filename = redactMaybe(kept.filename) ?? kept.filename;
                  return kept;
                })
              : stacktrace.frames,
          },
        };
      }),
    };
  }

  function scrubRequest(
    request: Record<string, unknown> | undefined,
  ): Record<string, unknown> | undefined {
    if (!request) return undefined;

    const headers: Record<string, string> = {};
    const sourceHeaders = request.headers;
    if (sourceHeaders && typeof sourceHeaders === 'object') {
      for (const [key, value] of Object.entries(
        sourceHeaders as Record<string, unknown>,
      )) {
        if (
          HEADER_ALLOWLIST.has(key.toLowerCase()) &&
          typeof value === 'string'
        ) {
          headers[key.toLowerCase()] = redactFreeText(value);
        }
      }
    }

    // Rebuilt, not spread: `data` (body), `cookies`, `env` (which carries
    // REMOTE_ADDR), and `query_string` are all dropped by omission.
    const url = pathOnly(request.url);
    return {
      ...(typeof request.method === 'string' ? { method: request.method } : {}),
      ...(url ? { url } : {}),
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
    };
  }

  function scrubBreadcrumbs(breadcrumbs: unknown): unknown[] | undefined {
    if (!Array.isArray(breadcrumbs)) return undefined;
    return breadcrumbs.map((crumb) => {
      if (!crumb || typeof crumb !== 'object') return crumb;
      // `data` is dropped wholesale: on http breadcrumbs it holds the full URL
      // with query string and the response body size, and on custom ones it is
      // whatever the caller passed.
      const kept = { ...(crumb as Record<string, unknown>) };
      delete kept.data;
      kept.message = redactMaybe(kept.message) ?? kept.message;
      return kept;
    });
  }

  function scrubTags(
    tags: Record<string, unknown> | undefined,
  ): Record<string, string> | undefined {
    if (!tags) return undefined;
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(tags)) {
      if (value === undefined || value === null) continue;
      out[key] = redactFreeText(String(value));
    }
    return out;
  }

  function scrubTraceContext(
    trace: Record<string, unknown>,
  ): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(trace)) {
      if (TRACE_FIELD_ALLOWLIST.has(key)) out[key] = value;
    }
    // Kept, but swept — the route is genuinely useful for grouping.
    if (typeof trace.description === 'string') {
      out.description = redactFreeText(trace.description);
    }
    // On a transaction this context *is* the root span: the SDK omits the
    // segment span from `event.spans`, so these attributes exist nowhere else.
    // Dropping the bag wholesale — as this did while only error events reached
    // here — left the one span an operator opens first with no method and no
    // status code, while every child span kept theirs. Same allowlist as a
    // child span's `data`, so the two cannot drift apart.
    const attributes = scrubAttributes(trace.data);
    if (Object.keys(attributes).length > 0) out.data = attributes;
    return out;
  }

  function scrubContexts(
    contexts: Record<string, unknown> | undefined,
  ): Record<string, unknown> | undefined {
    if (!contexts) return undefined;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(contexts)) {
      if (!CONTEXT_ALLOWLIST.has(key) || !value) continue;
      out[key] =
        key === 'trace'
          ? scrubTraceContext(value as Record<string, unknown>)
          : value;
    }
    return out;
  }

  /**
   * One allowlisted attribute value.
   *
   * OpenTelemetry permits array-valued attributes, and an instrumentation may
   * put an object here regardless of the spec. Passing a non-string through
   * untouched — which a `typeof value === 'string' ? redact : value` ternary
   * does — means a nested email or token rides out under an allowlisted key, so
   * anything that is not a string, number, or boolean is dropped, and arrays
   * are swept elementwise.
   */
  function scrubAttributeValue(value: unknown): unknown {
    if (typeof value === 'string') return redactFreeText(value);
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    if (Array.isArray(value)) {
      return value
        .map(scrubAttributeValue)
        .filter((entry) => entry !== undefined);
    }
    return undefined;
  }

  function scrubAttributes(bag: unknown): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    if (!bag || typeof bag !== 'object') return out;
    for (const [key, value] of Object.entries(bag as Record<string, unknown>)) {
      if (!SPAN_DATA_KEY_ALLOWLIST.has(key)) continue;
      const scrubbedValue = scrubAttributeValue(value);
      if (scrubbedValue !== undefined) out[key] = scrubbedValue;
    }
    return out;
  }

  /**
   * Measurements are `{ name: { value: number, unit: string } }`, and the
   * *names* are author-supplied, so they are swept like any other free text
   * rather than copied as keys.
   */
  function scrubMeasurements(measurements: unknown): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    if (!measurements || typeof measurements !== 'object') return out;
    for (const [key, entry] of Object.entries(
      measurements as Record<string, unknown>,
    )) {
      if (!entry || typeof entry !== 'object') continue;
      const { value, unit } = entry as { value?: unknown; unit?: unknown };
      if (typeof value !== 'number') continue;
      out[redactFreeText(key)] = {
        value,
        ...(typeof unit === 'string' ? { unit: redactFreeText(unit) } : {}),
      };
    }
    return out;
  }

  /**
   * `sdkProcessingMetadata`, rebuilt down to the two fields the SDK reads back
   * *after* this hook returns.
   *
   * It is not on either allowlist, so the copy loop drops it — and that turned
   * out to matter: `createEventEnvelopeHeaders` reads
   * `event.sdkProcessingMetadata.dynamicSamplingContext` to build the
   * envelope's `trace` header, and `client.js` reads back
   * `spanCountBeforeProcessing` to compute how many spans a `beforeSend*` hook
   * dropped. Returning an object without them silently cost every transaction
   * its DSC — no server-side dynamic sampling, no trace-root attribution — and
   * zeroed this scrubber's own dropped-span reporting.
   *
   * Carried field-by-field rather than passed through, because the same bag
   * also holds `normalizedRequest` — a full request object, query string
   * included. `capturedSpanScope` and `capturedSpanIsolationScope` are read at
   * `client.js` before the hook runs, so dropping them here is safe.
   */
  function scrubSdkProcessingMetadata(
    metadata: unknown,
  ): Record<string, unknown> | undefined {
    if (!metadata || typeof metadata !== 'object') return undefined;
    const source = metadata as Record<string, unknown>;
    const out: Record<string, unknown> = {};

    const dsc = source.dynamicSamplingContext;
    if (dsc && typeof dsc === 'object') {
      const kept: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(
        dsc as Record<string, unknown>,
      )) {
        if (!DSC_FIELD_ALLOWLIST.has(key)) continue;
        kept[key] = typeof value === 'string' ? redactFreeText(value) : value;
      }
      const dscTransaction = (dsc as Record<string, unknown>).transaction;
      if (typeof dscTransaction === 'string') {
        kept.transaction = pathOnly(dscTransaction);
      }
      if (Object.keys(kept).length > 0) out.dynamicSamplingContext = kept;
    }

    if (typeof source.spanCountBeforeProcessing === 'number') {
      out.spanCountBeforeProcessing = source.spanCountBeforeProcessing;
    }

    return Object.keys(out).length > 0 ? out : undefined;
  }

  function scrubSpan(span: unknown): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    // A non-object element would throw in `Object.entries` and, because the map
    // runs inside the caller's try, would drop the entire transaction rather
    // than the one bad span. Return an empty shell instead and let the rest
    // survive.
    if (!span || typeof span !== 'object') {
      return { data: {} };
    }
    const source = span as Record<string, unknown>;
    for (const [key, value] of Object.entries(source)) {
      if (!SPAN_FIELD_ALLOWLIST.has(key)) continue;
      out[key] = key === 'measurements' ? scrubMeasurements(value) : value;
    }

    // Kept but swept — the route and operation are what make a span readable.
    if (typeof source.description === 'string') {
      out.description = redactFreeText(source.description);
    }
    if (typeof source.op === 'string') out.op = redactFreeText(source.op);

    // `data` is non-optional on the SDK's span type, so it is always rebuilt
    // rather than omitted — an absent bag would not satisfy the shape.
    out.data = scrubAttributes(source.data);

    return out;
  }

  /**
   * `beforeSend`: the last thing that runs before an event leaves the process.
   *
   * Returns the scrubbed event, or `null` to drop it entirely. Nothing here may
   * throw — a scrubber that throws inside `beforeSend` is indistinguishable
   * from one that passes the event through unscrubbed in some SDK versions, so
   * the whole body is wrapped and a failure **drops the event**. Losing an
   * error report is strictly better than leaking a payload we failed to
   * inspect.
   */
  function scrubSentryEvent(event: ScrubbableEvent): ScrubbableEvent | null {
    try {
      const scrubbed: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(event)) {
        if (EVENT_KEY_ALLOWLIST.has(key)) {
          scrubbed[key] = value;
        }
      }

      if (event.exception) scrubbed.exception = scrubException(event.exception);
      scrubMessageInto(scrubbed, event.message);
      if (event.transaction) scrubbed.transaction = pathOnly(event.transaction);
      const transactionInfo = scrubTransactionInfo(event.transaction_info);
      if (transactionInfo) scrubbed.transaction_info = transactionInfo;
      if (event.tags) scrubbed.tags = scrubTags(event.tags);
      if (event.contexts) scrubbed.contexts = scrubContexts(event.contexts);
      // Author-set free text, so it goes through the sweep like any other.
      if (Array.isArray(event.fingerprint)) {
        scrubbed.fingerprint = event.fingerprint.map((part) =>
          typeof part === 'string' ? redactFreeText(part) : part,
        );
      }

      const request = scrubRequest(event.request);
      if (request && Object.keys(request).length > 0) scrubbed.request = request;

      const breadcrumbs = scrubBreadcrumbs(event.breadcrumbs);
      if (breadcrumbs?.length) scrubbed.breadcrumbs = breadcrumbs;

      // Read back by the SDK *after* this returns, on the error path exactly
      // as on the transaction path below — see the helper for why it is
      // rebuilt rather than allowlisted. Without this, `beforeSend` ships
      // every error event with no `trace` envelope header (#966).
      const sdkMetadata = scrubSdkProcessingMetadata(
        event.sdkProcessingMetadata,
      );
      if (sdkMetadata) scrubbed.sdkProcessingMetadata = sdkMetadata;

      // `user` is rebuilt from the id alone, and only when that id is already a
      // pseudonym (64 lowercase hex). Anything else — a raw uuid a stray
      // `setUser` call put there, an email, an ip — is dropped rather than
      // trusted. `username`/`email`/`ip_address` are never carried over.
      const user = scrubUser(event.user);
      if (user) scrubbed.user = user;

      return scrubbed as ScrubbableEvent;
    } catch {
      return null;
    }
  }

  /**
   * `beforeSendTransaction`: the transaction-event counterpart of
   * {@link scrubSentryEvent} (issue #896).
   *
   * Same doctrine, same primitives, same fail-closed contract — a throw returns
   * `null` and the transaction is dropped rather than emitted uninspected. The
   * difference is structural: the allowlist keeps `spans`, and each span is
   * rebuilt field-by-field, because span descriptions and attributes carry the
   * same query strings and identifiers the error path already sweeps.
   */
  function scrubSentryTransaction(
    event: ScrubbableEvent,
  ): ScrubbableEvent | null {
    try {
      const scrubbed: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(event)) {
        if (TRANSACTION_KEY_ALLOWLIST.has(key)) {
          scrubbed[key] = value;
        }
      }

      // `exception` and `message` are inherited from EVENT_KEY_ALLOWLIST, so
      // the loop above has already copied them through verbatim. On the error
      // path they are safe only because they are immediately overwritten with
      // scrubbed versions — inheriting the allowlist without inheriting those
      // two rebuilds is what let a raw stack-frame `vars` snapshot ride out of
      // here. The SDK does not populate either on a transaction today, but
      // `TransactionEvent extends Event` types both as legal, and this module
      // allowlists precisely so that "the SDK does not do that today" is never
      // load-bearing.
      if (event.exception) scrubbed.exception = scrubException(event.exception);
      scrubMessageInto(scrubbed, event.message);

      // The transaction name is a route, so it loses its query string exactly
      // as it does on the error path. Note the SDK downgrades
      // `transaction_info.source` to `custom` whenever this hook changes the
      // name, which it only does for names that contained an id or a query
      // string — those are exactly the names that must not ship raw, so the
      // lost URL clustering is accepted.
      if (event.transaction) scrubbed.transaction = pathOnly(event.transaction);
      const transactionInfo = scrubTransactionInfo(event.transaction_info);
      if (transactionInfo) scrubbed.transaction_info = transactionInfo;
      if (event.tags) scrubbed.tags = scrubTags(event.tags);
      if (event.contexts) scrubbed.contexts = scrubContexts(event.contexts);
      // Author-set free text on either class, swept the same way.
      if (Array.isArray(event.fingerprint)) {
        scrubbed.fingerprint = event.fingerprint.map((part) =>
          typeof part === 'string' ? redactFreeText(part) : part,
        );
      }
      if (event.measurements) {
        scrubbed.measurements = scrubMeasurements(event.measurements);
      }

      // Read back by the SDK *after* this returns — see the helper for why it
      // is rebuilt rather than allowlisted.
      const sdkMetadata = scrubSdkProcessingMetadata(
        event.sdkProcessingMetadata,
      );
      if (sdkMetadata) scrubbed.sdkProcessingMetadata = sdkMetadata;
      // `spans` is on the allowlist above, so it has already been copied
      // through verbatim by this point. Reassign when it is a real array, and
      // drop it outright when it is not — otherwise a malformed non-array value
      // would ride out on the allowlist copy without ever meeting
      // {@link scrubSpan}.
      if (Array.isArray(event.spans)) {
        scrubbed.spans = event.spans.map(scrubSpan);
      } else {
        delete scrubbed.spans;
      }

      const request = scrubRequest(event.request);
      if (request && Object.keys(request).length > 0) scrubbed.request = request;

      const breadcrumbs = scrubBreadcrumbs(event.breadcrumbs);
      if (breadcrumbs?.length) scrubbed.breadcrumbs = breadcrumbs;

      // Identical rule to the error path: an id survives only when it is
      // already a pseudonym, never because something upstream put a raw one
      // there.
      const user = scrubUser(event.user);
      if (user) scrubbed.user = user;

      return scrubbed as ScrubbableEvent;
    } catch {
      return null;
    }
  }

  return { redactFreeText, scrubSentryEvent, scrubSentryTransaction };
}

/**
 * Fields of the `trace` context that may survive.
 *
 * The trace context is the one allowlisted context that is *not* pure infra
 * metadata. On an HTTP span the SDK sets `description` to the route — including
 * its query string — and `data` to span attributes such as `http.url` and
 * `url.query`. Passing the context through whole, as an allowlist of context
 * *names* alone would, reintroduces exactly the query-string leak that
 * `request.url` and the free-text sweep close everywhere else.
 */
const TRACE_FIELD_ALLOWLIST = new Set([
  'trace_id',
  'span_id',
  'parent_span_id',
  'op',
  'status',
  'origin',
]);

/**
 * Top-level keys that may survive on a transaction event.
 *
 * The error-event allowlist plus the two keys that only exist on this class.
 * `spans` is the whole reason a separate scrubber exists — it carries the trace
 * payload, and dropping it would leave a delivered-but-empty transaction.
 */
const TRANSACTION_KEY_ALLOWLIST = new Set([
  ...EVENT_KEY_ALLOWLIST,
  'spans',
  'measurements',
]);

/**
 * Span fields that are pure identity, timing, or status — no user data.
 *
 * `description` and `op` are swept separately, `data` is rebuilt below, and
 * `links` is dropped by omission because span links carry their own free-form
 * attribute bags.
 */
const SPAN_FIELD_ALLOWLIST = new Set([
  'span_id',
  'parent_span_id',
  'trace_id',
  'start_timestamp',
  'timestamp',
  'status',
  'origin',
  'exclusive_time',
  'is_segment',
  'segment_id',
  'measurements',
]);

/**
 * Span attributes that may survive, by exact key.
 *
 * This is the one place this module keeps part of a `data` bag rather than
 * dropping it wholesale, and the divergence is deliberate. On a *transaction*
 * the spans are the payload, so dropping every attribute would gut the trace
 * this scrubber exists to preserve.
 *
 * It stays an allowlist to stay safe: OpenTelemetry attribute keys are
 * open-ended and routinely carry `http.url`, `url.query`, and `db.statement`,
 * every one of which is exactly the leak the free-text sweep closes elsewhere.
 * Anything not named here is dropped unread, and the survivors are swept anyway
 * — an allowlisted key is not a promise that a provider filled it sensibly.
 *
 * `sentry.op` and `sentry.origin` are deliberately absent: `spanToJSON` derives
 * the top-level `op` and `origin` from them and leaves the copies in `data`, so
 * allowlisting them here would ship each value twice per span.
 */
const SPAN_DATA_KEY_ALLOWLIST = new Set([
  'http.request.method',
  'http.response.status_code',
  'db.system',
  'sentry.source',
]);

/**
 * Fields of the Dynamic Sampling Context that may survive.
 *
 * These read like Sentry's own routing metadata, and on a trace this process
 * started they are. On a **continued** trace they are not: the whole DSC is
 * parsed straight out of the caller's inbound `baggage` header, and
 * `baggageHeaderToDynamicSamplingContext` applies no key or value filtering —
 * so `release` and `environment` are whatever the client sent. Every
 * allowlisted string is therefore swept, not just `transaction`; the allowlist
 * bounds which keys survive, never what they contain.
 */
const DSC_FIELD_ALLOWLIST = new Set([
  'trace_id',
  'public_key',
  'sample_rate',
  'sample_rand',
  'release',
  'environment',
  'sampled',
  'org_id',
]);

/**
 * A pseudonym that is already a pseudonym, or nothing.
 *
 * 64 lowercase hex is the shape of `hmacSha256Hex`'s output and nothing else
 * the codebase produces. Anything failing it — a raw uuid a stray `setUser`
 * call put there, an email, an ip — is dropped rather than trusted.
 *
 * Extracted into one function rather than inlined at both hooks (#865): the
 * predicate is the security control, and two byte-identical copies of a
 * security control is one copy that can be fixed and one that silently is not.
 * Nothing fails if they diverge, which is exactly why they must not be able to.
 */
function scrubUser(
  user: { id?: unknown } | undefined,
): { id: string } | undefined {
  const userId = user?.id;
  if (typeof userId === 'string' && /^[0-9a-f]{64}$/.test(userId)) {
    return { id: userId };
  }
  return undefined;
}
