import type { ErrorEvent, NodeOptions } from '@sentry/nestjs';
import { pseudonymizeIp, pseudonymizeUserId } from './pseudonyms';

/**
 * PII scrubbing for everything leaving the API for Sentry (issue #481).
 *
 * `spec/behavior/observability.md` § Error Tracking splits identifiers into two
 * classes, and this module is the single enforcement point for both — across
 * **both event classes**. The SDK routes those classes to two different hooks,
 * so this module exports two entry points, wired in `sentry-options.ts`:
 * {@link scrubSentryEvent} as `beforeSend` for error events, and
 * {@link scrubSentryTransaction} as `beforeSendTransaction` for transaction
 * (tracing) events.
 *
 * They cannot be the same function. `spans` is absent from
 * {@link EVENT_KEY_ALLOWLIST}, so pointing `beforeSendTransaction` at
 * {@link scrubSentryEvent} would deliver every transaction with its trace
 * payload silently emptied — the event still arrives, so nothing looks broken
 * (#896).
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
 * ({@link redactFreeText}), which is best-effort by construction and is the
 * weakest link here by design — hence the strictness everywhere else.
 */

/** Request headers worth keeping. Everything else is dropped unread. */
const HEADER_ALLOWLIST = new Set(['content-type', 'x-request-id']);

/**
 * Top-level event keys that may survive. Sentry's own envelope metadata plus
 * the fields we deliberately populate.
 *
 * `user`, `request`, `breadcrumbs`, and `fingerprint` are absent on purpose:
 * they are rebuilt field-by-field below rather than passed through. Leaving
 * `fingerprint` out means a non-array one is dropped rather than copied raw —
 * the SDK types it `string[]`, so anything else is already anomalous.
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
  'transaction_info',
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
 * Best-effort PII sweep over a free-text string (exception messages, culprits,
 * transaction names, breadcrumb messages).
 *
 * UUIDs are **pseudonymized rather than dropped**. Every UUID the API handles
 * is a user, chapter, or row id drawn from the same salt namespace, so hashing
 * one in a message yields byte-identical output to the `user`/`chapter` tags on
 * the same event. An operator can therefore still answer "is this the tenant
 * from the other error?" from the message alone — which is most of why the
 * message is worth keeping — while the raw id never leaves the process.
 *
 * Order matters: JWTs and key-shaped strings are consumed before the generic
 * sweeps so a token containing a dotted-quad-looking run is not partially
 * rewritten into something unrecognizable.
 */
export function redactFreeText(input: string): string {
  return input
    .replace(URL_QUERY_RE, (_match, uptoQuestionMark: string) =>
      uptoQuestionMark.slice(0, -1),
    )
    .replace(BEARER_RE, '[redacted:token]')
    .replace(JWT_RE, '[redacted:token]')
    .replace(KEYLIKE_RE, '[redacted:key]')
    .replace(EMAIL_RE, '[redacted:email]')
    .replace(UUID_RE, (uuid) => {
      const hashed = pseudonymizeUserId(uuid.toLowerCase());
      return hashed ? `[id:${hashed}]` : '[redacted:id]';
    })
    .replace(IPV4_RE, (ip) => {
      const hashed = pseudonymizeIp(ip);
      return hashed ? `[ip:${hashed}]` : '[redacted:ip]';
    })
    .replace(IPV6_RE, (ip) => {
      const hashed = pseudonymizeIp(ip);
      return hashed ? `[ip:${hashed}]` : '[redacted:ip]';
    });
}

function redactMaybe(value: unknown): string | undefined {
  return typeof value === 'string' ? redactFreeText(value) : undefined;
}

/** Path without query or fragment — query strings routinely carry tokens. */
function pathOnly(url: unknown): string | undefined {
  if (typeof url !== 'string' || !url) return undefined;
  const cut = url.search(/[?#]/);
  const trimmed = cut === -1 ? url : url.slice(0, cut);
  return redactFreeText(trimmed);
}

// ── Structural scrubbing ─────────────────────────────────────────────────────

function scrubException(
  exception: ErrorEvent['exception'],
): ErrorEvent['exception'] {
  if (!exception?.values) return exception;
  return {
    ...exception,
    values: exception.values.map((value) => ({
      ...value,
      value: redactMaybe(value.value) ?? value.value,
      // Stack frames keep file/line/function (code identity, not user data) but
      // `vars` is a snapshot of local variables — arbitrary request payload.
      stacktrace: value.stacktrace && {
        ...value.stacktrace,
        frames: value.stacktrace.frames?.map((frame) => {
          const kept = { ...frame };
          delete kept.vars;
          kept.filename = redactMaybe(frame.filename) ?? frame.filename;
          return kept;
        }),
      },
    })),
  };
}

function scrubRequest(
  request: ErrorEvent['request'],
): ErrorEvent['request'] | undefined {
  if (!request) return undefined;

  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(request.headers ?? {})) {
    if (HEADER_ALLOWLIST.has(key.toLowerCase()) && typeof value === 'string') {
      headers[key.toLowerCase()] = redactFreeText(value);
    }
  }

  // Rebuilt, not spread: `data` (body), `cookies`, `env` (which carries
  // REMOTE_ADDR), and `query_string` are all dropped by omission.
  const url = pathOnly(request.url);
  return {
    ...(request.method ? { method: request.method } : {}),
    ...(url ? { url } : {}),
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
  };
}

function scrubBreadcrumbs(
  breadcrumbs: ErrorEvent['breadcrumbs'],
): ErrorEvent['breadcrumbs'] {
  if (!breadcrumbs) return undefined;
  return breadcrumbs.map((crumb) => {
    // `data` is dropped wholesale: on http breadcrumbs it holds the full URL
    // with query string and the response body size, and on custom ones it is
    // whatever the caller passed.
    const kept = { ...crumb };
    delete kept.data;
    kept.message = redactMaybe(crumb.message) ?? crumb.message;
    return kept;
  });
}

function scrubTags(tags: ErrorEvent['tags']): ErrorEvent['tags'] {
  if (!tags) return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(tags)) {
    if (value === undefined || value === null) continue;
    out[key] = redactFreeText(String(value));
  }
  return out;
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

function scrubTraceContext(trace: Record<string, unknown>): typeof trace {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(trace)) {
    if (TRACE_FIELD_ALLOWLIST.has(key)) out[key] = value;
  }
  // Kept, but swept — the route is genuinely useful for grouping.
  if (typeof trace.description === 'string') {
    out.description = redactFreeText(trace.description);
  }
  // On a transaction this context *is* the root span: the SDK omits the segment
  // span from `event.spans`, so these attributes exist nowhere else. Dropping
  // the bag wholesale — as this did while only error events reached here — left
  // the one span an operator opens first with no method and no status code,
  // while every child span kept theirs. Same allowlist as a child span's `data`,
  // so the two cannot drift apart.
  const attributes = scrubAttributes(trace.data);
  if (Object.keys(attributes).length > 0) out.data = attributes;
  return out;
}

function scrubContexts(
  contexts: ErrorEvent['contexts'],
): ErrorEvent['contexts'] {
  if (!contexts) return undefined;
  const out: NonNullable<ErrorEvent['contexts']> = {};
  for (const [key, value] of Object.entries(contexts)) {
    if (!CONTEXT_ALLOWLIST.has(key) || !value) continue;
    out[key] = key === 'trace' ? scrubTraceContext(value) : value;
  }
  return out;
}

/**
 * `beforeSend`: the last thing that runs before an event leaves the process.
 *
 * Returns the scrubbed event, or `null` to drop it entirely. Nothing here may
 * throw — a scrubber that throws inside `beforeSend` is indistinguishable from
 * one that passes the event through unscrubbed in some SDK versions, so the
 * whole body is wrapped and a failure **drops the event**. Losing an error
 * report is strictly better than leaking a payload we failed to inspect.
 */
export function scrubSentryEvent(event: ErrorEvent): ErrorEvent | null {
  try {
    const scrubbed: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(event)) {
      if (EVENT_KEY_ALLOWLIST.has(key)) {
        scrubbed[key] = value;
      }
    }

    if (event.exception) scrubbed.exception = scrubException(event.exception);
    if (event.message) scrubbed.message = redactFreeText(event.message);
    if (event.transaction) scrubbed.transaction = pathOnly(event.transaction);
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

    // `user` is rebuilt from the id alone, and only when that id is already a
    // pseudonym (64 lowercase hex). Anything else — a raw uuid a stray
    // `setUser` call put there, an email, an ip — is dropped rather than
    // trusted. `username`/`email`/`ip_address` are never carried over.
    const userId = event.user?.id;
    if (typeof userId === 'string' && /^[0-9a-f]{64}$/.test(userId)) {
      scrubbed.user = { id: userId };
    }

    // Through `unknown`: the allowlist loop builds a plain record, so there is
    // no structural overlap for TypeScript to check against. The keys that
    // survive are exactly `EVENT_KEY_ALLOWLIST`, which is a subset of
    // `ErrorEvent`'s own, plus the rebuilt fields assigned below it.
    return scrubbed as unknown as ErrorEvent;
  } catch {
    return null;
  }
}

// ── Transaction events ───────────────────────────────────────────────────────

/**
 * Derived from the option type rather than imported by name.
 *
 * `@sentry/node` re-exports `ErrorEvent` but neither `TransactionEvent` nor
 * `SpanJSON`, so there is no name to import here. Naming them through the hook
 * this module is wired into keeps both in lockstep with the installed SDK: if
 * the signature changes, this stops compiling instead of silently scrubbing a
 * shape the SDK no longer sends.
 */
type TransactionEvent = Parameters<
  NonNullable<NodeOptions['beforeSendTransaction']>
>[0];
type TransactionSpan = NonNullable<TransactionEvent['spans']>[number];

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
 * dropping it wholesale, and the divergence is deliberate. {@link
 * scrubTraceContext} drops `trace.data` entirely because on an *error* event
 * the trace context is incidental metadata. On a *transaction* the spans are
 * the payload, so dropping every attribute would gut the trace this scrubber
 * exists to preserve.
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
 * One allowlisted attribute value.
 *
 * OpenTelemetry permits array-valued attributes, and an instrumentation may put
 * an object here regardless of the spec. Passing a non-string through untouched
 * — which a `typeof value === 'string' ? redact : value` ternary does — means a
 * nested email or token rides out under an allowlisted key, so anything that is
 * not a string, number, or boolean is dropped, and arrays are swept elementwise.
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
 * Measurements are `{ name: { value: number, unit: string } }`, and the *names*
 * are author-supplied, so they are swept like any other free text rather than
 * copied as keys.
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
 * Fields of the Dynamic Sampling Context that may survive. All are Sentry's own
 * routing metadata; `transaction` is the only free text and is swept below.
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
 * `sdkProcessingMetadata`, rebuilt down to the two fields the SDK reads back
 * *after* this hook returns.
 *
 * It is not on either allowlist, so the copy loop drops it — and that turned out
 * to matter: `createEventEnvelopeHeaders` reads
 * `event.sdkProcessingMetadata.dynamicSamplingContext` to build the envelope's
 * `trace` header, and `client.js` reads back `spanCountBeforeProcessing` to
 * compute how many spans a `beforeSend*` hook dropped. Returning an object
 * without them silently cost every transaction its DSC — no server-side dynamic
 * sampling, no trace-root attribution — and zeroed this scrubber's own
 * dropped-span reporting.
 *
 * Carried field-by-field rather than passed through, because the same bag also
 * holds `normalizedRequest` — a full request object, query string included.
 * `capturedSpanScope` and `capturedSpanIsolationScope` are read at `client.js`
 * before the hook runs, so dropping them here is safe.
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
    for (const [key, value] of Object.entries(dsc as Record<string, unknown>)) {
      if (DSC_FIELD_ALLOWLIST.has(key)) kept[key] = value;
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

function scrubSpan(span: TransactionSpan): TransactionSpan {
  const out: Record<string, unknown> = {};
  // A non-object element would throw in `Object.entries` and, because the map
  // runs inside the caller's try, would drop the entire transaction rather than
  // the one bad span. Return an empty shell instead and let the rest survive.
  if (!span || typeof span !== 'object') {
    return { data: {} } as unknown as TransactionSpan;
  }
  for (const [key, value] of Object.entries(span)) {
    if (!SPAN_FIELD_ALLOWLIST.has(key)) continue;
    out[key] = key === 'measurements' ? scrubMeasurements(value) : value;
  }

  // Kept but swept — the route and operation are what make a span readable.
  if (typeof span.description === 'string') {
    out.description = redactFreeText(span.description);
  }
  if (typeof span.op === 'string') out.op = redactFreeText(span.op);

  // `data` is non-optional on the SDK's span type, so it is always rebuilt
  // rather than omitted — an absent bag would not satisfy the shape.
  out.data = scrubAttributes(span.data);

  return out as unknown as TransactionSpan;
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
export function scrubSentryTransaction(
  event: TransactionEvent,
): TransactionEvent | null {
  try {
    const scrubbed: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(event)) {
      if (TRANSACTION_KEY_ALLOWLIST.has(key)) {
        scrubbed[key] = value;
      }
    }

    // `exception` and `message` are inherited from EVENT_KEY_ALLOWLIST, so the
    // loop above has already copied them through verbatim. On the error path
    // they are safe only because they are immediately overwritten with scrubbed
    // versions — inheriting the allowlist without inheriting those two rebuilds
    // is what let a raw stack-frame `vars` snapshot ride out of here. The SDK
    // does not populate either on a transaction today, but `TransactionEvent
    // extends Event` types both as legal, and this module allowlists precisely
    // so that "the SDK does not do that today" is never load-bearing.
    if (event.exception) scrubbed.exception = scrubException(event.exception);
    if (event.message) scrubbed.message = redactFreeText(event.message);

    // The transaction name is a route, so it loses its query string exactly as
    // it does on the error path. Note the SDK downgrades `transaction_info
    // .source` to `custom` whenever this hook changes the name, which it only
    // does for names that contained an id or a query string — those are exactly
    // the names that must not ship raw, so the lost URL clustering is accepted.
    if (event.transaction) scrubbed.transaction = pathOnly(event.transaction);
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

    // Read back by the SDK *after* this returns — see the helper for why it is
    // rebuilt rather than allowlisted.
    const sdkMetadata = scrubSdkProcessingMetadata(event.sdkProcessingMetadata);
    if (sdkMetadata) scrubbed.sdkProcessingMetadata = sdkMetadata;
    // `spans` is on the allowlist above, so it has already been copied through
    // verbatim by this point. Reassign when it is a real array, and drop it
    // outright when it is not — otherwise a malformed non-array value would
    // ride out on the allowlist copy without ever meeting {@link scrubSpan}.
    if (Array.isArray(event.spans)) {
      scrubbed.spans = event.spans.map(scrubSpan);
    } else {
      delete scrubbed.spans;
    }

    const request = scrubRequest(event.request);
    if (request && Object.keys(request).length > 0) scrubbed.request = request;

    const breadcrumbs = scrubBreadcrumbs(event.breadcrumbs);
    if (breadcrumbs?.length) scrubbed.breadcrumbs = breadcrumbs;

    // Identical rule to the error path: an id survives only when it is already
    // a pseudonym, never because something upstream put a raw one there.
    const userId = event.user?.id;
    if (typeof userId === 'string' && /^[0-9a-f]{64}$/.test(userId)) {
      scrubbed.user = { id: userId };
    }

    return scrubbed as unknown as TransactionEvent;
  } catch {
    return null;
  }
}
